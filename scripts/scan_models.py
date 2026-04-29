import os
import sys
from pathlib import Path
from ruamel.yaml import YAML
from ruamel.yaml.compat import StringIO
from ruamel.yaml.comments import CommentedMap
import json

yaml = YAML(typ='safe', pure=True)
yaml.width = 500
yaml.indent(mapping=2, sequence=4, offset=2)
yaml.default_flow_style = False

VALID_EXTENSIONS = ('.safetensors', '.pt', '.pth', ".gguf")
YAML_START_TAG = "CONFIG-DATA::"
MODEL_TYPES = ["vae", "checkpoints", "loras"]
NEGATIVE_SEPARATOR = "#negative:#"

SETTINGS_DIR = Path.cwd() / "input" / "ntx_data"

# utility for cleaning path names
def _clean_path(path):
    return path.replace("\\", os.path.sep).replace("/", os.path.sep)

def _order_data(data:dict):
    # force an order for the dict keys
    ordered_data = {}
    list_of_std_keys = ["id", "model_type", "hash", "model", "prompts", "download", "notes"]
    # - add standard keys in the given order
    for k in list_of_std_keys:
        if k in data:
            ordered_data[k] = data[k]
    # - add other keys as they appear in the original dict
    for k in data:
        if not(k in list_of_std_keys):
            ordered_data[k] = data[k]
    return ordered_data

class DataFile:
    def __init__(self, path: Path):
        if not (path.suffix in [".ntxdata", ".txt", ".yaml"]):
            raise RuntimeError(f"DataFile - Cannot process file with this extension : {path}")
        self.path = path
        self.data = {}
        self.data["id"] = ""

    @property
    def id(self):
        return self.data.get("id", "")
    @id.setter
    def id(self, value):
        self.data["id"] = value

    @property
    def model_type(self):
        return self.data.get("model_type", "")
    @model_type.setter
    def model_type(self, value):
        self.data["model_type"] = value

    def load(self):
        global YAML_START_TAG
        # read the text file if present, otherwise just use empty content
        text_part = ""
        yaml_part = ""
        txt_content = self.path.read_text(encoding="utf-8")
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
            self.data = {}
        else:
            self.data = data
        self.data["notes"] = text_part

    def save(self):
        global YAML_START_TAG

        # temporarily remove the notes
        notes_present = "notes" in self.data
        text_notes = self.data.pop("notes") if notes_present else ""

        # Serialize YAML to string
        buf = StringIO()
        yaml.dump(self.data, buf)
        yaml_out = buf.getvalue()

        # Write file: text part, marker line, YAML
        out_content = f"{text_notes}{YAML_START_TAG}\n{yaml_out}"
        self.path.write_text(out_content, encoding="utf-8")

        # restore the notes
        if notes_present:
            self.data["notes"] = text_notes
    
    def check_if_matching_files_modified(self):
        matching_files = list(self.path.parent.glob(self.path.stem + ".*"))
        for f in matching_files:
            if f.is_file():
                if f.stat().st_mtime > self.path.stat().st_mtime:
                    return True
        return False

    def sort_data_keys(self):
        # force an order for the dict keys
        ordered_data = {}
        list_of_std_keys = ["id", "model_type", "hash", "model", "prompts", "download", "notes"]
        # - add standard keys in the given order
        for k in list_of_std_keys:
            if k in self.data:
                ordered_data[k] = self.data[k]
        # - add other keys as they appear in the original dict
        for k in self.data:
            if not(k in list_of_std_keys):
                ordered_data[k] = self.data[k]
        self.data = ordered_data

def _replace_nulls(data: dict):
    for k,v in data.items():
        if v == None:
            data[k] = ""
        elif isinstance(v, (dict, CommentedMap)):
            _replace_nulls(v)

def _rebuild_data_file(path: Path) -> DataFile:

    # recover the text file yaml data if present
    txt_path = path.with_suffix(".txt")
    source_txt_file = DataFile(txt_path)
    if txt_path.exists():
        source_txt_file.load()
    data = source_txt_file.data

    # recover the civitai json data if present
    civitai_data = None
    # - file .civit.json
    civitai_data_path = path.with_suffix(".civit.json")
    if civitai_data_path.exists():
        with open(civitai_data_path, encoding="utf-8") as f:
            civitai_data = json.load(f)
        if not (isinstance(civitai_data, dict)):
            raise RuntimeError(f"DataFile - The '.civit.json' file is not a dict : {civitai_data_path}")
    # - file .metadata.json
    if civitai_data == None:
        civitai_data_path = path.with_suffix(".metadata.json")
        if civitai_data_path.exists():
            with open(civitai_data_path, encoding="utf-8") as f:
                civitai_data = json.load(f)
            if not (isinstance(civitai_data, dict)):
                raise RuntimeError(f"DataFile - The '.metadata.json' file is not a dict : {civitai_data_path}")
            if "civitai" in civitai_data:
                civitai_data = civitai_data["civitai"]
                if civitai_data != None: # if none, it is not considered an error : the logic in the rest of the routine will just ignore it
                    if not (isinstance(civitai_data, dict)):
                        raise RuntimeError(f"DataFile - The '.metadata.json' file is not a dict : {civitai_data_path}")
            else:
                raise RuntimeError(f"DataFile - The '.metadata.json' file does not have a 'civitai' section : {civitai_data_path}")

    # ensure there is an id and model_type field
    if not "id" in data:
        data["id"] = ""
    if not "model_type" in data:
        data["model_type"] = ""

    # rearrange the data : only modify if it's a mapping
    if isinstance(data, (dict, CommentedMap)):
        # Rename keys: lora -> model, checkpoint -> model (checkpoint overwrites lora)
        if "checkpoint" in data:
            chkp_data = data.pop("checkpoint")
            if not (isinstance(chkp_data, dict)):
                raise RuntimeError(f"DataFile - The 'checkpoint' section is not a dict : {txt_path}")
            if "model" in chkp_data:
                chkp_data["base_model_type"] = chkp_data.pop("model")
            if "sampler" in chkp_data:
                chkp_data["sampler_name"] = chkp_data.pop("sampler")
            data["model"] = chkp_data
        if "lora" in data:
            lora_data = data.pop("lora")
            if not (isinstance(lora_data, dict)):
                raise RuntimeError(f"DataFile - The 'lora' section is not a dict : {txt_path}")
            if "model" in lora_data:
                lora_data["base_model_type"] = lora_data.pop("model")
            # if "lora_strength" in lora_data:
            #     lora_data["strength_model"] = lora_data.pop("lora_strength")
            # if "clip_strength" in lora_data:
            #     lora_data["strength_clip"] = lora_data.pop("clip_strength")
            data["model"] = lora_data
        if "extras" in data:
            extras_data = data.pop("extras")
            if not (isinstance(extras_data, dict)):
                raise RuntimeError(f"DataFile - The 'extras' section is not a dict : {txt_path}")
            if not "model" in data:
                data["model"] = {}
            for k,v in extras_data.items():
                data["model"][k] = v
        if "prompts" in data:
            if not (isinstance(data["prompts"], dict)):
                raise RuntimeError(f"DataFile - The 'prompts' section is not a dict : {txt_path}")
    # else: leave non-mapping YAML unchanged

    # hashes
    hash_data = data.setdefault("hash", {})
    # - from file .sha256 if present
    sha_path = path.with_suffix(".sha256")
    if sha_path.exists():
        with open(sha_path, "r", encoding="utf-8") as f:
            first_line = f.readline()
            hash_data["sha256"] = first_line
    # - from civitai data if present
    if civitai_data != None:
        if "files" in civitai_data:
            node = civitai_data["files"]
            if isinstance(node, list):
                if len(node) > 0:
                    node = node[0]
                    if "hashes" in node:
                        node = node["hashes"]
                        if isinstance(node, dict):
                            if "SHA256" in node: hash_data["sha256"] = node["SHA256"]
                            if "AutoV2" in node: hash_data["autov2"] = node["AutoV2"]
    
    # add source data (create a new source section, which contains a list of sources):
    # - priority 1 : from civitai data, if present
    if civitai_data != None:
        model_base_id = civitai_data.get("modelId")
        model_version_id = civitai_data.get("id")
        temp_source_data = {}
        temp_source_data["name"] = "CIVITAI"
        temp_source_data["note"] = "from civitai metadata"
        temp_source_data["modelBaseId"] = model_base_id
        temp_source_data["modelVersionId"] = model_version_id
        temp_source_data["title"] = civitai_data.get("name")
        temp_source_data["web"] = f"https://civitai.com/models/{model_base_id}?modelVersionId={model_version_id}"
        temp_source_data["url"] = f"https://civitai.com/api/download/models/{model_version_id}"
        data.setdefault("download", []).append(temp_source_data)
    # - priority 2 : from original file, if there is a source section
    if "source" in data:
        temp_source_data = data.pop("source")
        if not (isinstance(temp_source_data, dict)):
            raise RuntimeError(f"DataFile - The 'source' section is not a dict : {txt_path}")
        temp_source_data["note"] = "original source in txt file"
        data.setdefault("download", []).append(temp_source_data)
    # - priority 3 : from .source file, if present (it is considered to be a YAML file)
    sourcefile_path = path.with_suffix(".source")
    if sourcefile_path.exists():
        sourcefile_content = sourcefile_path.read_text(encoding="utf-8")
        try:
            sourcefile_data = yaml.load(sourcefile_content)
        except Exception as e:
            raise RuntimeError(f"Failed to parse YAML in {sourcefile_path}: {e}") from e
        if "source" in sourcefile_data:
            temp_source_data = sourcefile_data.pop("source")
            if not (isinstance(temp_source_data, dict)):
                raise RuntimeError(f"DataFile - The 'source' section is not a dict : {sourcefile_path}")
            temp_source_data["note"] = "from specific source txt file"
            data.setdefault("download", []).append(temp_source_data)

    # Ensure there are no nulls
    _replace_nulls(data)

    # assemble the final data file
    resulting_data_file = DataFile(path)
    resulting_data_file.data = data
    return resulting_data_file

def _process_dir(root: Path, files_to_ignore: list, force_overwrite: bool, catalogue: list, model_type: str, log: list):
    global VALID_EXTENSIONS

    if not root.exists():
        print(f"Path does not exist: {root}", file=sys.stderr)
        return 2

    all_files = [p for p in root.rglob('*') if p.is_file() and p.suffix.lower() in VALID_EXTENSIONS]
    all_files = sorted(all_files)
    processed = 0
    skipped = 0
    root_len = len(str(root))+1
    for p in all_files:
        try:
            # Prepare output path with .ntxdata extension
            out_path = p.with_suffix(".ntxdata")

            # The file is rebuilt, unless 3 conditions are met:
            # - the file already exists 
            # - overwrite is not required
            # - the related files (i.e. files with different extension) have not been modified
            # If all 3 conditions are met, return the current content from file
            rebuild_file = True
            if out_path.exists():
                if force_overwrite == False:
                    data_file = DataFile(out_path)
                    if data_file.check_if_matching_files_modified() == False:
                        data_file.load()
                        data_file.id = str(p)[root_len:] # e.g. : N:/models/loras/chars/abc.safetensors => chars/abc.safetensors
                        data_file.model_type = model_type
                        data_file.sort_data_keys()
                        rebuild_file = False
                        skipped += 1 
            
            # else rebuild the file
            if rebuild_file:
                print(f"- rebuild ntxdata for {p}")
                data_file = _rebuild_data_file(out_path)
                data_file.id = str(p)[root_len:] # e.g. : N:/models/loras/chars/abc.safetensors => chars/abc.safetensors
                data_file.model_type = model_type
                data_file.sort_data_keys()
                data_file.save()
                processed += 1

            catalogue.append(data_file.data)
        except Exception as e:
            err_msg = f"! error processing {p}: {e}"
            print(err_msg, file=sys.stderr)
            log.append(err_msg)

    print(f"Processed: {processed}, Skipped (existing): {skipped}")
    return 0 

def generate_models_catalogue(models_dir: Path, model_types_mapping:dict, force_rescan:bool = False):
    global SETTINGS_DIR
    models_file = SETTINGS_DIR / "catalogue_of_ntxdata.json"
    models_to_ignore_file = SETTINGS_DIR / "models_to_ignore.txt"

    # files to ignore (because they do not have a Civitai record)
    models_to_ignore_text = ""
    if models_to_ignore_file.exists():
        with open(models_to_ignore_file, 'r', encoding='utf-8') as f:
            models_to_ignore_text = f.read()
    files_to_ignore = [mti.strip() for mti in models_to_ignore_text.splitlines() if mti.strip() != ""]

    # scan the models dir and build the catalogue
    root = models_dir
    catalogue = {}
    log = []
    for model_type,model_type_subdir in model_types_mapping.items():
        catalogue[model_type] = []
        _process_dir(root / model_type_subdir, files_to_ignore, force_rescan, catalogue[model_type], model_type, log)

    # write the catalogue to file
    catalogue["log"] = log
    models_file = SETTINGS_DIR / "catalogue_of_ntxdata.json"
    with open(models_file, 'w', encoding='utf-8') as f:
        json.dump(catalogue, f, ensure_ascii=False, indent=4, sort_keys=False)

    # return the result and errors if any
    msg = f"[generate_models_catalogue]\nResults written to: {models_file}"
    if len(log) > 0:
        msg += f"\nErrors: {len(log)}"
    else:
        msg += "\nNo errors"
    return msg
    
def generate_chars_catalogue():
    global SETTINGS_DIR
    models_file = SETTINGS_DIR / "catalogue_of_ntxdata.json"
    extra_chars_file = SETTINGS_DIR / "extra_chars.yaml"
    characters_file = SETTINGS_DIR / "characters.json"        
    
    prompts_data = {}

    # load chars defined in lora models
    if models_file.is_file():
        with open(models_file,'r', encoding='utf-8') as f:
            models_data = json.load(f)
        loras_data = models_data.get("loras", [])
        for full_model_data in loras_data:
            if ("model" in full_model_data) and ("prompts" in full_model_data):
                lora_id = full_model_data["id"]
                lora_data = full_model_data["model"]
                lora_prompts = full_model_data["prompts"]
                if (lora_data.get("category", "") == "chars") and (isinstance(lora_prompts, dict)):
                    char_name = lora_data.get("title", lora_id)
                    save_name = lora_data.get("save_name", char_name)
                    prompts_data_for_char = {}
                    lora_strength = lora_data.get("lora_strength", 1.0)
                    clip_strength = lora_data.get("clip_strength", 1.0)
                    lora_syntax = f"<lora:{lora_id}:{lora_strength}:{clip_strength}>".replace(',','.')
                    for prompt_name, prompt_text in lora_prompts.items():                    
                        prompt_parts = prompt_text.split(NEGATIVE_SEPARATOR)
                        prompts_data_for_char[prompt_name] = {
                            "positive": (prompt_parts[0] + ", " + lora_syntax).replace(',,',','),
                            "negative": prompt_parts[1] if len(prompt_parts) > 1 else "",
                            "save_name": save_name
                        }
                    prompts_data[char_name] = prompts_data_for_char
    
    # load additional chars defined in standalone forms
    if extra_chars_file.is_file():
        with open(extra_chars_file, 'r', encoding='utf-8') as f:
            extra_chars_text_data = f.read()
        yaml = ruamel.yaml.YAML(typ='safe', pure=True)
        extra_chars_data = yaml.load(extra_chars_text_data)
        for char_name, char_data in extra_chars_data.items():
            char_name_mod = char_name + " (extra)"
            save_name = char_data.get("extras", {}).get("save_name", char_name)
            prompts_data_for_char = {}
            for prompt_name, prompt_line in char_data.get("prompts", {}).items():
                prompt_parts = prompt_line.split(NEGATIVE_SEPARATOR)
                positive = prompt_parts[0]
                negative = prompt_parts[1] if len(prompt_parts) > 1 else ""
                prompts_data_for_char[prompt_name] = {
                    "positive": positive,
                    "negative": negative,
                    "save_name": save_name
                }
            prompts_data[char_name_mod] = prompts_data_for_char

    with open(characters_file, 'w', encoding='utf-8') as f:
        json.dump(prompts_data, f, ensure_ascii=False, indent=4)

    msg = f"[generate_chars_catalogue]\nResults written to: {characters_file}"
    return msg
