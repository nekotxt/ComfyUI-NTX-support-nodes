import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const ADDON_PREFIX = "NTX"
const API_PREFIX = "ntx-sn"


function isClassInList(name, list){
    var list2 = list.map(s=>ADDON_PREFIX+s);
    var res=list2.includes(name);
    return res;
}

function getWidget(node, name){
    for (var i in node.widgets){
        if(node.widgets[i].name == name)
            return node.widgets[i]
    }
    return null
}

function writeFloatToWidget(node, widget_name, data, data_name, default_value = null){
    var widget = getWidget(node, widget_name)
    if(widget == null)
        return;
    if((data_name in data) == false){
        if(default_value != null)
            widget.value = default_value;
        return;
    }
    var value = parseFloat(data[data_name])
    if(value == NaN){
        if(default_value != null)
            widget.value = default_value;
        return;
    }
    widget.value = value
}
function writeIntToWidget(node, widget_name, data, data_name, default_value = null){
    var widget = getWidget(node, widget_name)
    if(widget == null)
        return;
    if((data_name in data) == false){
        if(default_value != null)
            widget.value = default_value;
        return;
    }
    var value = parseInt(data[data_name])
    if(value == NaN){
        if(default_value != null)
            widget.value = default_value;
        return;
    }
    widget.value = value
}
function writeStringToWidget(node, widget_name, data, data_name, default_value = null){
    var widget = getWidget(node, widget_name)
    if(widget == null)
        return;
    if((data_name in data) == false){
        if(default_value != null)
            widget.value = default_value;
        return;
    }
    var value = data[data_name]
    if(value == null){
        if(default_value != null)
            widget.value = default_value;
        return;
    }
    widget.value = value
}

app.registerExtension({ 
	name: API_PREFIX + ".nodes.extension",

    async nodeCreated(node) {

        if(isClassInList(node.comfyClass, ["LoadCheckpointInfo"])){
            // recover references to the widgets used by the script   ["PromptLora"].map(s=>ADDON_PREFIX+s).includes(node.comfyClass)
            var widget_ckpt_name = getWidget(node, "ckpt_name")
            if (widget_ckpt_name == null) return

            // define the function to load the model data
            function getModelData(){
                // recover and assign the model data
                var query_data = {ckpt_name: widget_ckpt_name.value}
                fetch(`/${API_PREFIX}/get_checkpoint_info`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(query_data)
                })
                .then(response => response.json())
                .then(data => { 
                    writeIntToWidget(node, "clip_skip", data, "clip_skip", -1)
                    writeStringToWidget(node, "vae_name", data, "vae", "Baked VAE")
                    writeIntToWidget(node, "steps", data, "steps", 20)
                    writeFloatToWidget(node, "cfg", data, "cfg", 3.0)
                    writeStringToWidget(node, "sampler_name", data, "sampler_name", "euler")
                    writeStringToWidget(node, "scheduler", data, "scheduler", "simple")
                    writeStringToWidget(node, "model_prompt_positive", data, "positive", "")
                    writeStringToWidget(node, "model_prompt_negative", data, "negative", "")
                    writeStringToWidget(node, "notes", data, "notes", "")
                })
                .catch(error => {console.error('Error(get_checkpoint_info):', error);} );
            }

            // add a right-click menu entry which enables to fill the model data
            const original_getExtraMenuOptions = node.getExtraMenuOptions;
            node.getExtraMenuOptions = function(_, options) {
                original_getExtraMenuOptions?.apply(this, arguments);
                options.push({
                    content: `[${ADDON_PREFIX}] Load model data`,
                    callback: async () => {
                        getModelData()
                    }
                })
            }
            
            // create a callback which loads the model data when the model is changed
            widget_ckpt_name.callback = (val) => {
                //alert("New checkpoint selected : " + val)
                getModelData()
            }
        }

        if(isClassInList(node.comfyClass, ["LoadCharInfo", "LoadCharacterInfo"])){

            // recover references to the widgets used by the script
            var widget_subcategory = getWidget(node, "name")
            if (widget_subcategory == null) return
            var widget_entry = getWidget(node, "option")
            if (widget_entry == null) return

            // when a character is selected, load a list of options
            widget_subcategory.callback = (val) => {
                var query_data = {char_name: val}
                fetch(`/${API_PREFIX}/get_options_for_char`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(query_data)
                })
                .then(response => response.json())
                .then(data => { 
                    if("values" in widget_entry.options)
                        if("options_for_char" in data)
                            widget_entry.options["values"] = data["options_for_char"];
                            // if there is only one entry, load the first value of the list as prompt
                            if(data["options_for_char"].length == 1){
                                widget_entry.value = data["options_for_char"][0]
                            // if the current value is not in the new list, load the first value of the list as prompt
                            }else if(!(widget_entry.value in data["options_for_char"])){
                                widget_entry.value = data["options_for_char"][0]
                            }
                            getAndCopyPromptData()
                })
                .catch(error => {console.error('Error(get_options_for_char):', error);} );
            }

            // define the functions to copy the prompt data to the output text fields
            function getAndCopyPromptData(){
                var query_data = {char_name: widget_subcategory.value, option_name: widget_entry.value}
                fetch(`/${API_PREFIX}/get_prompt_for_char_option`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(query_data)
                })
                .then(response => response.json())
                .then(data => {
                    console.log(data)
                    writeStringToWidget(node, "char", data, "positive")
                    writeStringToWidget(node, "save_name", data, "save_name")

                })
                .catch(error => {console.error('Error(get_prompt_for_char_option):', error);} );
            }

            // when a prompt options is selected, copy value to prompt
            widget_entry.callback = (val) => {
                getAndCopyPromptData()
            }
        }

    }
})
