# VER 1.0

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

from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.compat import StringIO
from ruamel.yaml.comments import CommentedMap
yaml = YAML(typ='safe', pure=True)
yaml.width = 500
yaml.indent(mapping=2, sequence=4, offset=2)
yaml.default_flow_style = False

# Configure logging
import logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

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
                logger.error(f"Failed to parse YAML in {path}: {e}")
                raise
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
        _replace_nulls(data)

        # enforce the standard order of main keys
        self.reorder_data()

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
