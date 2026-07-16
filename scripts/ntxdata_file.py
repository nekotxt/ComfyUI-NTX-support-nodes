# VER 1.2

"""
Example of ntxdata file:

id: ILL/chars/mychar.safetensors
model_type: loras
model:
  base_model_type: ILL
  category: chars
  clip_strength: 1.0
  lora_strength: 1.0
  positive: the positive prompt,
  negative: ''
  save_name: mysave
  title: mychar
prompts:
  variant1: some action,
  variant2: standing still,
download:
  - modelBaseId: 123456
    modelVersionId: 7890123
    name: CIVITAI
    note: from civitai metadata
    title: The Civitai Name
    url: https://civitai.com/api/download/models/7890123
    web: https://civitai.com/models/123456?modelVersionId=7890123
hash:
  autov2: A78AILS901
  sha256: A78AILS9017B9F1EC646B91D2BBB3CB3FF66CD323921A38D91A7489639A5E7CF
notes: extra notes
"""

import os
import json

from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.compat import StringIO
from ruamel.yaml.comments import CommentedMap
yaml = YAML(typ='safe', pure=True)
yaml.width = 500
yaml.indent(mapping=2, sequence=4, offset=2)
yaml.default_flow_style = False

NTX_FILE_EXTENSION = ".ntxdata"
YAML_START_TAG = "CONFIG-DATA::"
YAML_END_TAG = "NOTES::"
ORDER_MAIN_KEYS = ["id", "model_type", "model", "prompts", "download", "hash", "notes"]
ORDER_MODEL_KEYS = ["title", "base_model_type", "clip_skip", "vae", "category", "positive", "negative", "sampler_name", "scheduler", "steps", "cfg", "lora_strength", "clip_strength", "save_name", "notes"]

def _replace_nulls(data: dict):
    for k,v in data.items():
        if v == None:
            data[k] = ""
        elif isinstance(v, (dict, CommentedMap)):
            _replace_nulls(v)

# utility for cleaning path names
def _clean_path(path):
    return path.replace("\\", os.path.sep).replace("/", os.path.sep)

def _sort_keys(data, list_of_ordered_keys):
    # force an order for the dict keys
    ordered_data = {}
    # - add standard keys in the given order
    for k in list_of_ordered_keys:
        if k in data:
            ordered_data[k] = data[k]
    # - add other keys as they appear in the original dict
    for k in data:
        if not(k in list_of_ordered_keys):
            ordered_data[k] = data[k]
    return ordered_data

class NtxDataFile:
    
    def __init__(self, path:Path = None, data:dict = {}):
        _replace_nulls(data) # Ensure there are no nulls
        self.path = path
        self.data = data

    @property
    def id(self):
        return self.data.get("id", "")
    @id.setter
    def id(self, value):
        self.data["id"] = _clean_path(value)

    @property
    def model_type(self):
        return self.data.get("model_type", "")
    @model_type.setter
    def model_type(self, value):
        self.data["model_type"] = value
    
    def check_if_matching_files_modified(self):
        if self.path is None:
            return False

        matching_files = list(self.path.parent.glob(self.path.stem + ".*"))
        for f in matching_files:
            if f.is_file():
                if f.stat().st_mtime > self.path.stat().st_mtime:
                    return True
        return False

    def sort_data_keys(self):
        global ORDER_MAIN_KEYS
        global ORDER_MODEL_KEYS

        ordered_data = _sort_keys(self.data, ORDER_MAIN_KEYS)
        if "model" in ordered_data:
            ordered_data["model"] = _sort_keys(ordered_data["model"], ORDER_MODEL_KEYS)
        self.data = ordered_data

    def load(self, path:Path = None):
        global YAML_START_TAG
        global YAML_END_TAG

        if path is None:
            # try to use the stored path
            if self.path is None:
                raise Exception("Path is not specified")
            else:
                path = self.path
        else:
            # update the value of the stored path
            self.path = path

        file_text = path.read_text(encoding="utf-8")

        if YAML_START_TAG in file_text:
            # Split content into notes (before YAML_START_TAG) and YAML parts (after YAML_START_TAG)
            idx = file_text.find(YAML_START_TAG)            
            notes_part = file_text[:idx]
            yaml_part = file_text[idx + len(YAML_START_TAG):].lstrip("\r\n").replace("\t", "    ")
        elif YAML_END_TAG in file_text:
            # Split content into YAML parts (before YAML_END_TAG) and notes (after YAML_END_TAG)
            idx = file_text.find(YAML_END_TAG)            
            yaml_part = file_text[:idx].replace("\t", "    ")
            notes_part = file_text[idx + len(YAML_END_TAG):].lstrip("\r\n")
        else:
            yaml_part = file_text
            notes_part = ""

        # Parse YAML content with error handling
        data = {}
        if not yaml_part.strip():
            pass
        else:
            try:
                data = yaml.load(yaml_part)
            except Exception as e:
                # if there is no note section, assume this is a text, otherwise rise an error
                if notes_part == "":
                    notes_part = yaml_part
                else:
                    raise Exception(f"Failed to parse YAML in {path}: {e}")
        if data is None:
            data = {}
        if notes_part:
            data["notes"] = notes_part

        # Ensure id is properly formatted
        if "id" in data:
            data["id"] = _clean_path(data["id"])

        # Ensure there are no nulls
        _replace_nulls(data)

        self.data = data

        self.path = path

    def save(self, path:Path = None):
        global YAML_END_TAG

        if path is None:
            # try to use the stored path
            if self.path is None:
                raise Exception("Path is not specified")
            else:
                path = self.path
        else:
            # update the value of the stored path
            self.path = path

        # Ensure there are no nulls
        _replace_nulls(self.data)

        # enforce the standard order of main keys
        self.sort_data_keys()

        # temporarily remove the notes
        notes_present = "notes" in self.data
        text_notes = self.data.pop("notes") if notes_present else ""

        try:
            # Serialize YAML to string
            buf = StringIO()
            yaml.dump(self.data, buf)
            yaml_out = buf.getvalue()

            # Write file: text part, marker line, YAML
            out_content = f"{yaml_out}{YAML_END_TAG}\n{text_notes}"
            path.write_text(out_content, encoding="utf-8")
        finally:
            # restore the notes
            if notes_present:
                self.data["notes"] = text_notes

    # def get_downloads(self) -> (str, str, list(str)):

    #     model_id = self.id

    #     model_hash = self.data.get("hash", {}).get("sha256", "")

    #     model_downloads = []
    #     for download_data in self.data.get("download", []):
    #         if "url" in download_data:
    #             model_downloads.append(download_data.get("url"))

    #     return (model_id, model_hash, model_downloads)

def create_ntxdata_file(path:Path) -> NtxDataFile:
    global NTX_FILE_EXTENSION

    path = path.with_suffix(NTX_FILE_EXTENSION)

    # recover the text file yaml data if present    
    txt_path = path.with_suffix(".txt") # txt_path = path
    source_txt_file = NtxDataFile(path=txt_path)
    if txt_path.exists():
        source_txt_file.load()
    data = source_txt_file.data

    # recover the civitai json data if present
    civitai_data = None
    # - file .civit.json (downloaded manually) => highest priority
    civitai_data_path = path.with_suffix(".civit.json")
    if civitai_data_path.exists():
        with open(civitai_data_path, encoding="utf-8") as f:
            civitai_data = json.load(f)
        if not (isinstance(civitai_data, dict)):
            raise RuntimeError(f"DataFile - The '.civit.json' file is not a dict : {civitai_data_path}")
    # - file .metadata.json (downloaded by LoraManager) => lowest priority, ignored if .civit.json exists
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

    # rearrange the data (for older versions of the file): only modify if it's a mapping
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
            # if "lora_strength" in lora_data: # <= OUTDATED, it now uses lora_strength and clip_strength
            #     lora_data["strength_model"] = lora_data.pop("lora_strength")
            # if "clip_strength" in lora_data:
            #     lora_data["strength_clip"] = lora_data.pop("clip_strength")
            data["model"] = lora_data
        # The values in the old extras section are assigned to the main data dict
        if "extras" in data:
            extras_data = data.pop("extras")
            if not (isinstance(extras_data, dict)):
                raise RuntimeError(f"DataFile - The 'extras' section is not a dict : {txt_path}")
            if not "model" in data:
                data["model"] = {}
            for k,v in extras_data.items():
                data["model"][k] = v
        # The prompts section is left unchanged, but check that it is a valid dict
        if "prompts" in data:
            if not (isinstance(data["prompts"], dict)):
                raise RuntimeError(f"DataFile - The 'prompts' section is not a dict : {txt_path}")
    # else: leave non-mapping YAML unchanged

    # hashes : try to collect them if not present
    if "hash" in data:
        if not (isinstance(data["hash"], dict)):
            raise RuntimeError(f"Hashes - The 'hash' section is not a dict : {txt_path}")
    else:
        data["hash"] = {}
    hash_data = data.get("hash")
    if hash_data.get("sha256", "") == "":
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
    if "download" in data:
        if not (isinstance(data["download"], list)):
            raise RuntimeError(f"Downloads - The 'download' section is not a list : {txt_path}")
    else:
        data["download"] = []
    download_data = data.get("download")
    if len(download_data) == 0:
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
            download_data.append(temp_source_data)
        # - priority 2 : from original file, if there is a source section
        if "source" in data:
            temp_source_data = data.pop("source")
            if not (isinstance(temp_source_data, dict)):
                raise RuntimeError(f"DataFile - The 'source' section is not a dict : {txt_path}")
            temp_source_data["note"] = "original source in txt file"
            download_data.append(temp_source_data)
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
                download_data.append(temp_source_data)
    else:
        # check that the existing items are valid dict
        for download_item in download_data:
            if not (isinstance(download_item, dict)):
                raise RuntimeError(f"Downloads - One or more of the 'download' section items is not a dict : {txt_path}")
            if not ("url" in download_item):
                raise RuntimeError(f"Downloads - One or more of the 'download' section items has no url : {txt_path}")

    # assemble the final data file
    resulting_data_file = NtxDataFile(path=path, data=data)
    return resulting_data_file
