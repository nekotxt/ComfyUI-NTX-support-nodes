import json
import hashlib
import os
import requests
import shutil
import subprocess
from pathlib import Path
from ruamel.yaml import YAML
#import subprocess
from tqdm import tqdm

msg_log = []
def log_message(text:str):
    print(text)
    msg_log.append(text)

err_log = []
def log_error(text:str):
    print("! ERROR : " + text)
    err_log.append(text)


def clean_path(path:str):
    return path.replace("\\", os.path.sep).replace("/", os.path.sep)

def load_yaml_file(path: Path):
    YAML_START_TAG = "CONFIG-DATA::"

    yaml = YAML(typ='safe', pure=True)
    yaml.width = 500
    yaml.indent(mapping=2, sequence=4, offset=2)
    yaml.default_flow_style = False

    # read the text file if present, otherwise just use empty content
    text_part = ""
    yaml_part = ""
    txt_content = path.read_text(encoding="utf-8")
    idx = txt_content.find(YAML_START_TAG)
    if idx != -1:
        text_part = txt_content[:idx]
        yaml_part = txt_content[idx + len(YAML_START_TAG):].lstrip("\r\n").replace("\t", "    ")

    # Load YAML (allow empty -> None)
    data = None
    if yaml_part.strip() != "":
        try:
            data = yaml.load(yaml_part)
        except Exception as e:
            raise RuntimeError(f"Failed to parse YAML in {path}: {e}") from e

    # ensure we have a mapping to modify
    if data is None:
        data = {}
    
    data["notes"] = text_part

    return data

# download the model from web
def download_file(url, save_path):
    # Send a GET request to the URL
    response = requests.get(url, stream=True)
    response.raise_for_status()  # Raise an exception for bad responses

    # Get the total file size
    total_size = int(response.headers.get('content-length', 0))

    # Ensure the directory exists
    os.makedirs(save_path.parent, exist_ok=True)

    # Open the file in binary write mode
    with open(save_path, 'wb') as file, tqdm(
        desc=f"- {save_path.name}",
        total=total_size,
        unit='iB',
        unit_scale=True,
        unit_divisor=1024,
    ) as progress_bar:
        for data in response.iter_content(chunk_size=1024):
            size = file.write(data)
            progress_bar.update(size)

    log_message(f"- file downloaded successfully")

def try_downloads(model_type:str, name:str, model:dict, save_path:Path, tokens:dict, cloud_storage_id:str):

    urls = []

    # an url property at top level, gets the highest priority
    if "url" in model:
        url = model.get("url", "").strip()
        if url != "":
            urls.append(url)
    
    # then it checks all entries in the download section
    if "download" in model:
        downloads = model.get("download", [])
        for download_data in downloads:
            url = download_data.get("url", "").strip()
            if url != "":
                urls.append(url)
    
    # if len(urls) == 0:
    #     log_error(f"- the download url for the model '{name}' is not defined")
    #     return False

    for url in urls:
        try:
            # check if url contains 'civitai', if so add token
            if "civitai" in url.lower():
                url = url + "?token=" + tokens.get("civitai", "")
                log_message(f"- civitai download, adding token")

            # actual download
            download_file(url, save_path)
            return True
        except Exception as x:
            log_error(f"for model {name} : {str(x)}")

    # try to download from cloud storage
    log_message(f"- try download from cloud storage {cloud_storage_id}:models/{model_type}/{name}")
    result = subprocess.run(["rclone", "copy", f"{cloud_storage_id}:models/{model_type}/{name}", f"{save_path.parent}", "-P"], capture_output=True, text=True)
    if result.stderr == "":
        log_message("- file downloaded from cloud storage")
        return True

    log_error(f"- it was not possible to find a valid download for model '{name}'")
    return False

# calculate the hash of the file
def create_sha256(file_path, force_recalc:bool = False):
    sha256_path = file_path.with_suffix('.sha256')
    
    if not file_path.is_file():
        log_error(f"- file {file_path} does not exist!")
        return ""
    
    if sha256_path.is_file() and (force_recalc == False):
        v_sha256 = sha256_path.read_text()
        log_message(f"- hash already exists, skipping [{v_sha256}]")
        return v_sha256

    # Calculate SHA256 hash
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    v_sha256 = sha256_hash.hexdigest()
    # Write SHA256 hash to new file
    with open(sha256_path, 'w') as f:
        f.write(v_sha256)
    # Print the result to console
    log_message( "- hash : create new .sha256 file")
    log_message(f"         SHA256: {v_sha256}")

    return v_sha256

def main_execution(downloads_dir:Path, models_dir:Path, tokens:dict, simulation_only:bool=False, cloud_storage_id:str=""):
    global msg_log
    global err_log
    msg_log = []
    err_log = []

    log_message(f"Downloads dir is {downloads_dir}")
    log_message(f"Models dir is {models_dir}")
    
    models_list = []
    for f in downloads_dir.glob("*.ntxdata"):
        if f.is_file():
            models_list.append(f)

    n_total = len(models_list)
    n = 0
    for f in models_list:
        n = n + 1
        model = load_yaml_file(f)
        name = model.get("id", "").strip()
        
        try:
            model_type = model.get("model_type", "").strip()
            log_message(f"[{n}/{n_total}] Scanning {model_type}/{name} ...")
            if model_type == "":
                log_error(f"- the model type for the model '{name}' is not defined")
                continue

            save_path = models_dir / model_type / clean_path(name)
            log_message(f"- full path {save_path}")

            # check if the file already exists
            file_exists = save_path.is_file()
            if file_exists:
                log_message(f"- file already exists, skipping download")

            # stop here if it is just a simulation
            if simulation_only:
                continue

            # try download the file, and check if the file now exists
            downloaded = False
            if not file_exists:
                downloaded = try_downloads(model_type, name, model, save_path, tokens, cloud_storage_id)
                file_exists = save_path.is_file()

            # if there is a file, retrieve the hash (always calculate it if the file was just downloaded) and check the match with the model data
            if file_exists:
                calculated_sha256 = create_sha256(save_path, force_recalc=downloaded).strip().lower()
            
                stored_sha256 = model.get("hash", {}).get("sha256", "").strip().lower()
                if stored_sha256 != "" and calculated_sha256 != "":
                    if stored_sha256 != calculated_sha256:
                        log_error(f"The hash of the file is different from the expected stored hash\n" +
                                    f"  > file             : {save_path}\n" +
                                    f"  > hash of the file : {calculated_sha256}\n" +
                                    f"  > expected hash    : {stored_sha256}\n" +
                                    f"  The file may be incorrect or corrupted")
            
            # also copy the ntxdata if not present, or if the file was actually downloaded
            ntxdata_path = save_path.with_suffix('.ntxdata')
            if ntxdata_path.is_file() and (not downloaded):
                log_message("- ntxdata file already exists, skip")
            else:
                log_message("- copy the ntxdata file")
                shutil.copy(f, ntxdata_path)
        
        except Exception as x:
            log_error(f"for model {name} : {str(x)}")

    if len(err_log) == 0:
        print("Execution terminated without errors")
    else:
        print(f"There were {len(err_log)} errors :")
        for msg in err_log:
            print(f"- {msg}")
