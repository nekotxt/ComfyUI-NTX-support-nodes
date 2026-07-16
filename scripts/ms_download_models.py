# TITLE : download models specified in download dir, or from list
# VER 1.0 (without _main_)

import hashlib
import json
import logging
import os
import requests
import shutil
import subprocess
import sys

try:
    import folder_paths
except:
    pass

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from ruamel.yaml import YAML
from tqdm import tqdm
from typing import List, Dict, Optional, Tuple
from urllib.parse import urljoin, urlparse, parse_qs, urlencode

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ---[Check if a model file exists]---

# utility for cleaning path names
def clean_path(path:str):
    return path.replace("\\", os.path.sep).replace("/", os.path.sep)

def get_model_file_path(models_dir:Path, subpath:str) -> (bool, Path):
    """Return the absolute file Path of a model:
    - models_dir : the target default models dir (e.g. /workspace/ComfyUI/models)
    - subpath (e.g. loras/ILL/styles/fantasy.safetensors)
    Return a tuple with flag (True if model exists already) and full path (if model found, otherwise default path = models_dir/subpath)
    The routine tries to use Comfy folder_paths if available, otherwise just checks models_dir/subpath
    """
    # default path if the model does not exist
    save_path = models_dir / subpath
    try:
        # try to use the comfy folder_paths, if available
        (folder_name, filename) = clean_path(subpath).split(os.path.sep, 1)
        file_path = folder_paths.get_full_path(folder_name, filename)
        if file_path == None:
            return (False, save_path)
        else:
            return (True, Path(file_path))
    except:
        # otherwise just check the standard path
        return (save_path.is_file(), save_path)

# ---[Utilities to recover the model data]---

@dataclass
class ModelData:
    subpath: str = ""
    file_hash: str = None
    urls: list = None
    ntxdata_path: Path = None
    title: str = ""

def parse_list_file(path) -> List[ModelData]:
    """Extracts the model data from a list file.
    """
    lines = []
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            lines.append(raw)
    return parse_list(lines)

def parse_list_text(text) -> List[ModelData]:
    """Extracts the model data from a multiline text.
    """
    lines = text.splitlines()
    return parse_list(lines)

def parse_list(lines) -> List[ModelData]:
    """Extracts the model data
    Each model is provided with:
    - file_subpath : subpath of the model (e.g. loras/styles/mystle.safetensors)
    - file_hash : optional has of the file, always starting with hash: (e.g. hash:1029383478)
    - urls : list of download urls for the file
    """

    blocks = []
    file_subpath = file_hash = None
    urls = []
    line_in_block = 0

    for raw in lines:
        line = raw.rstrip("\r\n").strip()

        if line.startswith("#"):
            continue

        if line == "":
            if file_subpath:
                blocks.append(ModelData(subpath=file_subpath, file_hash=file_hash, urls=urls))
            file_subpath = file_hash = None
            urls = []
            line_in_block = 0
            continue

        if line_in_block == 0:
            file_subpath = line
        elif line.lower().startswith("hash:"):
            file_hash = line[5:]
        elif line.lower().startswith("sha256:"):
            file_hash = line[7:]
        else:
            urls.append(line)
        line_in_block += 1

    if file_subpath:
        blocks.append(ModelData(subpath=file_subpath, file_hash=file_hash, urls=urls))

    return blocks
   
def load_modeldata_from_ntxdata_file(path: Path) -> ModelData:
    """
    Load model metadata from .ntxdata file
    
    Args:
        path: Path to .ntxdata file
        
    Returns:
        Dictionary containing model metadata
    """

    from ntxdata_file import NtxDataFile

    datafile = NtxDataFile()
    datafile.load(path=path)
    data = datafile.data

    # extract the importand data

    file_subpath = (data.get("model_type", "") + "/" + data.get("id", "")).replace("\\", "/")
    
    file_hash = data.get("hash", {}).get("sha256", None)

    urls = []
    # - top-level URL has highest priority
    if "url" in data:
        url = data.get("url", "").strip()
        if url:
            urls.append(url)        
    # - check download section
    if "download" in data:
        downloads = data.get("download", [])
        for download_data in downloads:
            url = download_data.get("url", "").strip()
            if url:
                urls.append(url)

    return ModelData(subpath=file_subpath, file_hash=file_hash, urls=urls, ntxdata_path=path)


def select_from_ntxdata_catalogue(catalogue_path: Path) -> List[ModelData]:

    with open(catalogue_path,'r', encoding='utf-8') as f:
        data:dict = json.load(f)

    full_models_list = []

    for model_type, models_dict_list in data.items():
        if model_type == "log":
            continue
        model_type = model_type.replace('\\', '/')
        
        for data_dict in models_dict_list:
            model_id = data_dict.get("id", "")
            if model_id == "":
                continue
            model_id = model_id.replace('\\', '/')
            subpath = f"{model_type}/{model_id}"
            
            file_hash = data_dict.get("hash", {}).get("sha256", None)
            if file_hash != None:
                file_hash = f"hash:{file_hash}"
            
            urls = []
            for dwdata in data_dict.get("download", []):
                url = dwdata.get("url", "")
                if url != "":
                    urls.append(url)

            title = str(data_dict.get("model", {}).get("title", ""))
            if title == "":
                title = str(Path(subpath).stem) + " [" + str(subpath) + "]"
            else:
                title = title + " [" + str(subpath) + "]"
            
            model_data = ModelData(subpath=subpath, file_hash=file_hash, urls=urls, title=title)
            full_models_list.append(model_data)

    models_list = full_models_list

    while True:
        print("Active models:")
        for i, model_data in enumerate(models_list, 1):
            print(f"  {i}) {model_data.title}")
        print(f"Total {len(models_list)} models")

        try:
            choice = input("Input a filter to be run on the active models (R to reset, A to select all active models, number to select a specific model, M to select multiple models): ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nKeyboard error - Exiting.")
            return []

        if choice.upper() == "R":
            models_list = full_models_list
            continue

        if choice.upper() == "A":
            return models_list

        if choice.upper() == "M":
            selected_models = []
            model_indexes = input("Specify the model numbers: ").strip()
            for model_index in model_indexes.split(" "):
                model_index = model_index.strip()
                if not model_index.isdigit() or not (1 <= int(model_index) <= len(models_list)):
                    continue
                model_index = int(model_index)
                selected_models.append(models_list[model_index-1])
                print(f"  {model_index}) {models_list[model_index-1].title}")
            return selected_models

        if choice.isdigit():
            model_index = int(choice)
            if not (1 <= int(model_index) <= len(models_list)):
                print(f"\nSelection must be between 1 and {len(models_list)}")
                continue
            return [models_list[model_index-1]]
        
        filtered_list = []
        for model_data in models_list:
            if choice in model_data.title:
                filtered_list.append(model_data)
        models_list = filtered_list

# ---[Utilities to download the models and check the hash]---

class DownloadStatus(Enum):
    """Status of a model download operation"""
    SUCCESS = "success"
    SKIPPED = "skipped"
    FAILED = "failed"
    HASH_MISMATCH = "hash_mismatch"

@dataclass
class DownloadResult:
    """Result of a download operation"""
    name: str
    status: DownloadStatus
    path: Optional[Path] = None
    error: Optional[str] = None
    hash_verified: bool = False

@dataclass
class ExecutionSummary:
    """Summary of the entire execution"""
    total_models: int
    results: List[DownloadResult] = field(default_factory=list)
    downloaded_files: List[Path] = field(default_factory=list)
    
    @property
    def success_count(self) -> int:
        return sum(1 for r in self.results if r.status == DownloadStatus.SUCCESS)
    
    @property
    def error_count(self) -> int:
        return sum(1 for r in self.results if r.status == DownloadStatus.FAILED)
    
    @property
    def skipped_count(self) -> int:
        return sum(1 for r in self.results if r.status == DownloadStatus.SKIPPED)
    
    def get_errors(self) -> List[str]:
        return [f"{r.name}: {r.error}" for r in self.results if r.error]

    def append_summary(self, summary):
        self.total_models = self.total_models + summary.total_models
        self.results.extend(summary.results)
        self.downloaded_files.extend(summary.downloaded_files)

class ModelDownloader:
    """Handles downloading and validation of model files"""
    
    # Configuration constants
    DOWNLOAD_TIMEOUT = 300  # 5 minutes
    CHUNK_SIZE = 8192  # 8KB chunks for both download and hash
    MAX_RETRIES = 3
    RETRY_DELAY = 2  # seconds
    
    def __init__(self, models_dir:Path, tokens: Dict[str, str], cloud_storage_id: str = ""):
        self.models_dir = models_dir
        self.tokens = tokens
        self.cloud_storage_id = cloud_storage_id
        self.session = self._create_session()
    
    def _create_session(self) -> requests.Session:
        """Create a requests session with retry configuration"""
        session = requests.Session()
        # Configure retries
        from requests.adapters import HTTPAdapter
        from urllib3.util.retry import Retry
        
        retry_strategy = Retry(
            total=self.MAX_RETRIES,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET"]
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        
        return session
    
    def _add_civitai_token(self, url: str) -> str:
        """Add Civitai token to URL if needed"""
        if "civitai" not in url.lower():
            return url
        
        token = self.tokens.get("civitai", "")
        if not token:
            logger.warning("Civitai URL detected but no token provided")
            return url
        
        # Parse URL and add token parameter
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        params['token'] = [token]
        
        new_query = urlencode(params, doseq=True)
        return parsed._replace(query=new_query).geturl()
    
    def _download_file_from_url(self, url: str, save_path: Path) -> bool:
        """
        Download a file with progress bar and proper error handling
        
        Args:
            url: URL to download from
            save_path: Path where to save the file
            
        Returns:
            True if download successful, False otherwise
        """
        try:
            # Ensure parent directory exists
            save_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Use temporary file to avoid partial downloads
            temp_path = save_path.with_suffix('.tmp')
            
            response = self.session.get(
                url, 
                stream=True, 
                timeout=self.DOWNLOAD_TIMEOUT
            )
            response.raise_for_status()
            
            total_size = int(response.headers.get('content-length', 0))
            
            with open(temp_path, 'wb') as file, tqdm(
                desc=f"Downloading {save_path.name}",
                total=total_size,
                unit='iB',
                unit_scale=True,
                unit_divisor=1024,
            ) as progress_bar:
                for data in response.iter_content(chunk_size=self.CHUNK_SIZE):
                    size = file.write(data)
                    progress_bar.update(size)
            
            # Move temp file to final location only if complete
            temp_path.replace(save_path)
            logger.info(f"  Downloaded successfully: {save_path.name}")
            return True
            
        except requests.exceptions.RequestException as e:
            logger.error(f"  Download failed for {url}: {e}")
            # Clean up temp file if it exists
            if temp_path.exists():
                temp_path.unlink()
            return False
        except Exception as e:
            logger.error(f"  Unexpected error downloading {url}: {e}")
            if temp_path.exists():
                temp_path.unlink()
            return False
    
    def _download_file_from_cloud(
        self, 
        model_subpath: str, 
        save_path: Path
    ) -> bool:
        """Download from cloud storage using rclone"""
        cloud_path = f"{self.cloud_storage_id}:models/{model_subpath}"
        
        try:
            result = subprocess.run(
                ["rclone", "copy", cloud_path, str(save_path.parent), "-P"],
                capture_output=True,
                text=True,
                timeout=self.DOWNLOAD_TIMEOUT
            )
            
            # Check return code, not just stderr
            if result.returncode == 0 and save_path.exists():
                logger.info("  Downloaded from cloud storage successfully")
                return True
            else:
                logger.error(f"  Cloud download failed: {result.stderr}")
                return False
                
        except subprocess.TimeoutExpired:
            logger.error("  Cloud download timed out")
            return False
        except FileNotFoundError:
            logger.warning("  rclone not found in PATH")
            return False
        except Exception as e:
            logger.error(f"  Cloud download error: {e}")
            return False
    
    def try_downloads(
        self, 
        model_subpath: str, 
        urls: list, 
    ) -> bool:
        """
        Try multiple download sources until one succeeds
        
        Args:
            model_subpath: (e.g., 'loras/styles/mymodel.safetensors')
            urls: list of possible download sources
            model: Model metadata dictionary
            
        Returns:
            True if download successful from any source
        """
        
        save_path = self.models_dir / model_subpath

        # Try each URL
        for url in urls:
            logger.info(f"  Attempting download from: {url}")
            url = self._add_civitai_token(url)
            
            if self._download_file_from_url(url, save_path):
                return True
        
        # Try cloud storage as fallback
        if self.cloud_storage_id:
            logger.info("  Trying cloud storage download...")
            if self._download_file_from_cloud(model_subpath, save_path):
                return True
        
        logger.error(f"  All download sources failed for: {model_subpath}")
        return False

class HashValidator:
    """Handles file hash calculation and validation"""
    
    CHUNK_SIZE = 65536  # 64KB chunks for faster hashing
    
    @staticmethod
    def calculate_sha256(file_path: Path, force_recalc: bool = False) -> Optional[str]:
        """
        Calculate SHA256 hash of a file, with caching
        
        Args:
            file_path: Path to file to hash
            force_recalc: Force recalculation even if cache exists
            
        Returns:
            SHA256 hash as hex string (lowercase), or None if file doesn't exist
        """
        if not file_path.is_file():
            logger.error(f"  File does not exist: {file_path}")
            return None
        
        sha256_path = file_path.with_suffix('.sha256')
        
        # Use cached hash if available and not forcing recalc
        if sha256_path.is_file() and not force_recalc:
            cached_hash = sha256_path.read_text().strip().lower()
            logger.info(f"  Using cached hash: {cached_hash}")
            return cached_hash
        
        # Calculate new hash
        logger.info("  Calculating SHA256 hash...")
        sha256_hash = hashlib.sha256()
        
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(HashValidator.CHUNK_SIZE), b""):
                sha256_hash.update(chunk)
        
        hash_value = sha256_hash.hexdigest().lower()
        
        # Cache the hash
        sha256_path.write_text(hash_value)
        logger.info(f"  Hash calculated and cached: {hash_value}")
        
        return hash_value
    
    @staticmethod
    def verify_hash(file_path: Path, expected_hash: str, force_recalc: bool = False) -> bool:
        """
        Verify file hash matches expected value
        
        Args:
            file_path: Path to file
            expected_hash: Expected SHA256 hash
            force_recalc: Force hash recalculation
            
        Returns:
            True if hash matches, False otherwise
        """
        if not expected_hash:
            logger.warning("  No expected hash provided, skipping verification")
            return True
        
        calculated_hash = HashValidator.calculate_sha256(file_path, force_recalc)
        
        if not calculated_hash:
            return False
        
        expected_hash = expected_hash.strip().lower()
        
        if calculated_hash == expected_hash:
            logger.info("  Hash verification successful")
            return True
        else:
            logger.error(
                f"  Hash mismatch!\n"
                f"    Expected: {expected_hash}\n"
                f"    Got:      {calculated_hash}"
            )
            return False

# ---[Main execution loop]---

def generate_report(summary: ExecutionSummary) -> List[str]:
    """Generate human-readable execution report"""
    report = []
    
    report.append("=" * 60)
    report.append("EXECUTION SUMMARY")
    report.append("=" * 60)
    report.append(f"Total models processed: {summary.total_models}")
    report.append(f"Successfully downloaded: {summary.success_count}")
    report.append(f"Skipped (already exist): {summary.skipped_count}")
    report.append(f"Failed: {summary.error_count}")
    report.append("")
    
    # List errors if any
    errors = summary.get_errors()
    if errors:
        report.append("ERRORS:")
        report.append("-" * 60)
        for error in errors:
            report.append(f"  • {error}")
        report.append("")
    
    # List downloaded files
    if summary.downloaded_files:
        report.append("NEWLY DOWNLOADED FILES:")
        report.append("-" * 60)
        for file_path in summary.downloaded_files:
            report.append(f"  • {file_path}")
        report.append("")
    
    # Status message
    if summary.error_count == 0:
        report.append("✓ Execution completed successfully!")
    else:
        report.append(f"⚠ Execution completed with {summary.error_count} error(s)")
    
    report.append("=" * 60)
    
    return report

def process_single_model(
    model_data: ModelData,
    models_dir: Path,
    downloader: ModelDownloader,
    validator: HashValidator,
    simulation_only: bool
) -> DownloadResult:
    """
    Process a single model file (for parallel execution)
    
    Args:
        model_data: Model info for download
        models_dir: Directory where to save models
        downloader: ModelDownloader instance
        validator: HashValidator instance
        loader: ModelMetadataLoader instance
        simulation_only: If True, only simulate, don't download
        
    Returns:
        DownloadResult with operation status
    """
    try:
        name = model_data.subpath        
        #save_path = models_dir / model_data.subpath
        expected_hash = None if model_data.file_hash == None else model_data.file_hash.lower()

        logger.info(f"Processing {name}")

        # Check if file exists
        #file_exists = save_path.is_file()
        (file_exists, save_path) = get_model_file_path(models_dir, model_data.subpath)
        
        if file_exists:
            logger.info(f"  File already exists: {save_path}")
            
            # Verify hash if provided
            if expected_hash:
                #hash_valid = validator.verify_hash(save_path, expected_hash)
                calculated_hash = validator.calculate_sha256(save_path, force_recalc=False)
                if calculated_hash != expected_hash:
                    return DownloadResult(
                        name=name,
                        status=DownloadStatus.HASH_MISMATCH,
                        path=save_path,
                        error="  Hash mismatch for existing file",
                        hash_verified=False
                    )
            
            return DownloadResult(
                name=name,
                status=DownloadStatus.SKIPPED,
                path=save_path,
                hash_verified=bool(expected_hash)
            )
        
        if simulation_only:
            logger.info("  Simulation mode - would download")
            return DownloadResult(
                name=name,
                status=DownloadStatus.SKIPPED,
                path=save_path
            )
        
        # Download the file
        download_success = downloader.try_downloads(model_data.subpath, model_data.urls)
        
        if not download_success:
            return DownloadResult(
                name=name,
                status=DownloadStatus.FAILED,
                error="  All download sources failed"
            )
        
        # Verify hash after download
        calculated_hash = validator.calculate_sha256(save_path, force_recalc=True)
        hash_valid = (calculated_hash == expected_hash) if expected_hash else True
        status = DownloadStatus.SUCCESS if hash_valid else DownloadStatus.HASH_MISMATCH

        # Copy ntxdata file
        if model_data.ntxdata_path:
            ntxdata_path = save_path.with_suffix('.ntxdata')
            shutil.copy(model_data.ntxdata_path, ntxdata_path)
            logger.info(f"  Copied metadata file from:{model_data.ntxdata_path} to: {ntxdata_path}")
        
        return DownloadResult(
            name=name,
            status=status,
            path=save_path,
            hash_verified=hash_valid,
            error="  Hash mismatch after download" if not hash_valid else None
        )
        
    except Exception as e:
        logger.exception(f"  Error processing {model_data.subpath}")
        return DownloadResult(
            name=model_data.subpath,
            status=DownloadStatus.FAILED,
            error=str(e)
        )

def process_list_of_models(models_list:List[ModelData], models_dir:Path, tokens:dict, cloud_storage_id:str, max_workers:int, simulation_only:bool) -> ExecutionSummary:
    """
    Main execution function - orchestrates model downloads
    
    Args:
        models_list: List of models to download
        models_dir: Base directory where models will be stored
        tokens: Dictionary of API tokens (e.g., {"civitai": "token123"})
        cloud_storage_id: rclone remote ID for cloud storage fallback
        max_workers: Maximum number of parallel downloads
        simulation_only: If True, only simulate without downloading
        
    Returns:
        List of log messages summarizing execution
    """
    logger.info(f"Models directory: {models_dir}")
    logger.info(f"Simulation mode: {simulation_only}")
    logger.info(f"Max parallel workers: {max_workers}")
    
    # Initialize components
    downloader = ModelDownloader(models_dir=models_dir, tokens=tokens, cloud_storage_id=cloud_storage_id)
    validator = HashValidator()
    
    # Initialize summary
    summary = ExecutionSummary(total_models=len(models_list))
    
    # Process models in parallel
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all tasks
        future_to_file = {
            executor.submit(
                process_single_model,
                model_data,
                models_dir,
                downloader,
                validator,
                simulation_only
            ): model_data
            for model_data in models_list
        }
        
        # Collect results as they complete
        for future in as_completed(future_to_file):
            result = future.result()
            summary.results.append(result)
            
            if result.status == DownloadStatus.SUCCESS and result.path:
                summary.downloaded_files.append(result.path)
     
    return summary

def main_loop(models_dir:str, lists_dir:str, ntxdata_dir:str, catalogue_path:str, tokens:dict, cloud_storage_id:str, max_workers:int=3, simulation_only:bool=False):
    models_dir = Path(models_dir)
    lists_dir = Path(lists_dir)
    ntxdata_dir = Path(ntxdata_dir)
    catalogue_path = Path(catalogue_path)

    while True:
        print("")
        print("=" * 40)
        print(f"  Downloader — models_dir: {models_dir}")
        print("=" * 40)

        list_files = sorted(f for f in lists_dir.rglob("*.dwlst", case_sensitive=False) if f.is_file)

        if len(list_files) == 0:
            print(f"No .dwlst files found in {lists_dir}")

        print("")
        for i, f in enumerate(list_files, 1):
            print(f"  {i}) {f.stem}")
        print("")
        print(f"  D) Scan {ntxdata_dir}\\*.ntxdata")
        print("")
        if catalogue_path.exists():
            print(f"  C) Select from catalogue {catalogue_path}")
        print("")
        print("  X) Exit")
        print("")

        try:
            choices = input(f"Select a file (0-{len(list_files)} or x): ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nExiting.")
            sys.exit(0)

        choices = choices.strip().upper()

        if choices == "X":
            print("Exiting.")
            sys.exit(0)

        elif choices == "D":
            models_list = [load_modeldata_from_ntxdata_file(f) for f in ntxdata_dir.rglob("*.ntxdata", case_sensitive=False) if f.is_file]
            overall_summary = process_list_of_models(models_list=models_list, models_dir=models_dir, tokens=tokens, cloud_storage_id=cloud_storage_id, max_workers=max_workers, simulation_only=simulation_only)

        elif choices == "C":
            models_list = select_from_ntxdata_catalogue(catalogue_path=catalogue_path)
            overall_summary = process_list_of_models(models_list=models_list, models_dir=models_dir, tokens=tokens, cloud_storage_id=cloud_storage_id, max_workers=max_workers, simulation_only=simulation_only)

        else:
            overall_summary = None

            for choice in choices.split(" "):

                choice = choice.strip()

                if not choice.isdigit() or not (1 <= int(choice) <= len(list_files)):
                    print(f"Invalid selection {choice}. Please try again.")
                    continue
                choice = int(choice)
                models_list = parse_list_file(list_files[choice - 1])
                
                summary = process_list_of_models(models_list=models_list, models_dir=models_dir, tokens=tokens, cloud_storage_id=cloud_storage_id, max_workers=max_workers, simulation_only=simulation_only)

                if overall_summary is None:
                    overall_summary = summary
                else:
                    overall_summary.append_summary(summary)
            
        # Generate summary report
        if overall_summary is not None:
            result = generate_report(overall_summary)
            for line in result:
                print(line)

def download_models_from_text_list(text:str, models_dir:str, tokens:dict):
    models_dir = Path(models_dir)
    models_list = parse_list_text(text)
    summary = process_list_of_models(models_list=models_list, models_dir=models_dir, tokens=tokens, cloud_storage_id="", max_workers=1, simulation_only=False)
    report = generate_report(summary)
    output = ""
    for line in report:
        output = output + line + "\n\r"
    return output
