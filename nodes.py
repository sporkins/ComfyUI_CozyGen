import os
import json
import torch
import numpy as np
from PIL import Image, ImageOps
from PIL.PngImagePlugin import PngInfo
import base64 # New import
import io # New import
from urllib.parse import parse_qs, urlparse

import folder_paths
from nodes import SaveImage, LoadImage
import server # Import server
import asyncio # Import Import asyncio
from comfy.comfy_types import node_typing, ComfyNodeABC, InputTypeDict
from comfy.comfy_types.node_typing import IO



class _CozyGenDynamicTypes(str):
    basic_types = node_typing.IO.PRIMITIVE.split(",")

    def __eq__(self, other):
        return other in self.basic_types or isinstance(other, (list, _CozyGenDynamicTypes))

    def __ne__(self, other):
        return not self.__eq__(other)

CozyGenDynamicTypes = _CozyGenDynamicTypes("COZYGEN_DYNAMIC_TYPE")


class CozyGenDynamicInput(ComfyNodeABC):
    _NODE_CLASS_NAME = "CozyGenDynamicInput" # Link to custom JavaScript

    @classmethod
    def INPUT_TYPES(cls) -> InputTypeDict:
        return {
            "required": {
                "param_name": (IO.STRING, {"default": "Dynamic Parameter"}),
                "priority": (IO.INT, {"default": 10}),                
                "param_type": ([IO.STRING, IO.INT, IO.FLOAT, IO.BOOLEAN, "DROPDOWN"], {"default": IO.STRING}),
                "default_value": (IO.STRING, {"default": ""}),
            },
            "optional": {
                "add_randomize_toggle": (IO.BOOLEAN, {"default": False}),
                "choice_type": (IO.STRING, {"default": ""}),
                "display_bypass": (IO.BOOLEAN, {"default": False}),
            },
            "hidden": {
                "choices": (IO.STRING, {"default": ""}), # Used by JS for dropdowns
                "multiline": (IO.BOOLEAN, {"default": False}), # Used by JS for strings
                "min_value": (IO.FLOAT, {"default": 0.0}), # Used by JS for numbers
                "max_value": (IO.FLOAT, {"default": 1.0}), # Used by JS for numbers
                "step": (IO.FLOAT, {"default": 0.0}), # Used by JS for numbers
            }
        }

    RETURN_TYPES = (IO.ANY,) # Can return any type
    FUNCTION = "get_dynamic_value"

    CATEGORY = "CozyGen"

    def get_dynamic_value(self, param_name, priority, param_type, default_value, add_randomize_toggle=False, choice_type="", min_value=0.0, max_value=1.0, choices="", multiline=False, step=None, display_bypass=False):
        # Convert default_value based on param_type
        if param_type == IO.INT:
            try:
                value = int(default_value)
            except (ValueError, TypeError):
                value = 0  # Default to 0 if conversion fails
        elif param_type == IO.FLOAT:
            try:
                value = float(default_value)
            except (ValueError, TypeError):
                value = 0.0  # Default to 0.0 if conversion fails
        elif param_type == IO.BOOLEAN:
            value = str(default_value).lower() == "true"
        elif param_type == "DROPDOWN":
            value = default_value # For dropdowns, default_value is already the selected string
        else:  # STRING or any other type
            value = default_value
        return (value, )


class CozyGenBoolInput:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "param_name": (IO.STRING, {"default": "Bool Parameter"}),
                "priority": (IO.INT, {"default": 10}),                
                "value": (IO.BOOLEAN, { "default": False })
            },
        }

    RETURN_TYPES = (IO.BOOLEAN,) # Can return any type
    FUNCTION = "get_value"

    CATEGORY = "CozyGen/Static"

    def get_value(self, param_name, priority, value):
        return (value, )


class CozyGenImageInput(ComfyNodeABC):
    @classmethod
    def INPUT_TYPES(s) -> InputTypeDict:
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        files = folder_paths.filter_files_content_types(files, ["image"])
        
        return {
            "required": {
                "param_name": (IO.STRING, {"default": "Image Input"}),
                "priority": (IO.INT, { "default": 0 }),
                "image": (sorted(files), { "image_upload": True, "image_folder": "input" }),
            }
        }
    
    # The return types are now the standard IMAGE and MASK for ComfyUI image loaders.
    RETURN_TYPES = (IO.IMAGE, )
    FUNCTION = "load_image"
    CATEGORY = "CozyGen"

    def load_image(self, param_name, priority,  image : str):
        return (LoadImage.load_image(None, image)[0], )

        
class CozyGenOutput(SaveImage):
    def __init__(self):
        super().__init__()
        self.output_dir = folder_paths.get_output_directory()

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": (IO.IMAGE, ),
            },
            "optional": {
                "filename_prefix": (IO.STRING, {"default": "CozyGen/output"}),
            },
            "hidden": {
                "run_id": (IO.STRING, {"default": ""}),
            },
        }

    FUNCTION = "save_images"
    CATEGORY = "CozyGen"

    def save_images(self, images, filename_prefix="CozyGen/output", run_id=""):
        results = super().save_images(images, filename_prefix)
        server_instance = server.PromptServer.instance

        if server_instance and results and 'ui' in results and 'images' in results['ui']:
            batch_images_data = []
            for saved_image in results['ui']['images']:
                image_url = f"/view?filename={saved_image['filename']}&subfolder={saved_image['subfolder']}&type={saved_image['type']}"
                batch_images_data.append({
                    "url": image_url,
                    "filename": saved_image['filename'],
                    "subfolder": saved_image['subfolder'],
                    "type": saved_image['type']
                })
            
            if batch_images_data:
                message_data = {
                    "status": "images_generated",
                    "images": batch_images_data
                }
                server_instance.send_sync("cozygen_batch_ready", message_data)
                print(f"CozyGen: Sent batch WebSocket message: {message_data}")

        return results


import imageio

class CozyGenVideoOutput:
    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
        self.type = "output"
        self.prefix_append = ""

    @classmethod
    def INPUT_TYPES(s):
        return {
        "required": {
            "images": (IO.IMAGE, ),
                "frame_rate": (IO.INT, {"default": 8, "min": 1, "max": 24}),
                "loop_count": (IO.INT, {"default": 0, "min": 0, "max": 100}),
                "filename_prefix": (IO.STRING, {"default": "CozyGen/video"}),
                "format": (["video/webm", "video/mp4", "image/gif"],),
                "pingpong": (IO.BOOLEAN, {"default": False}),
            },
            "hidden": {
                "run_id": (IO.STRING, {"default": ""}),
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "save_video"
    OUTPUT_NODE = True

    CATEGORY = "CozyGen"

    def save_video(self, images, frame_rate, loop_count, filename_prefix="CozyGen/video", format="video/webm", pingpong=False, run_id=""):
        filename_prefix += self.prefix_append
        full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(filename_prefix, self.output_dir, images[0].shape[1], images[0].shape[0])
        results = list()
        
        if format == "image/gif":
            ext = "gif"
        elif format == "video/mp4":
            ext = "mp4"
        else:
            ext = "webm"

        file = f"{filename}_{counter:05}_.{ext}"
        
        # imageio requires uint8
        video_data = (images.cpu().numpy() * 255).astype(np.uint8)

        if pingpong:
            video_data = np.concatenate((video_data, video_data[-2:0:-1]), axis=0)

        if format == "image/gif":
            imageio.mimsave(os.path.join(full_output_folder, file), video_data, duration=(1000/frame_rate)/1000, loop=loop_count)
        else:
            imageio.mimsave(os.path.join(full_output_folder, file), video_data, fps=frame_rate)

        results.append({
            "filename": file,
            "subfolder": subfolder,
            "type": self.type
        })

        server_instance = server.PromptServer.instance
        if server_instance:
            for result in results:
                video_url = f"/view?filename={result['filename']}&subfolder={result['subfolder']}&type={result['type']}"
                message_data = {
                    "status": "video_generated",
                    "video_url": video_url,
                    "filename": result['filename'],
                    "subfolder": result['subfolder'],
                    "type": result['type']
                }
                server_instance.send_sync("cozygen_video_ready", message_data)
                print(f"CozyGen: Sent custom WebSocket message: {{'type': 'cozygen_video_ready', 'data': {message_data}}}")

        return { "ui": { "videos": results } }

class CozyGenVideoPreviewOutput:
    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
        get_temp = getattr(folder_paths, "get_temp_directory", None)
        self.temp_dir = get_temp() if callable(get_temp) else None

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "video_path": (IO.STRING, {"default": ""}),
            },
            "hidden": {
                "run_id": (IO.STRING, {"default": ""}),
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "preview_video"
    OUTPUT_NODE = True
    CATEGORY = "CozyGen"

    def _normalize_view_payload(self, video_path):
        if not video_path:
            return None

        raw = str(video_path).strip()
        if not raw:
            return None

        # Allow users to pass a /view URL directly.
        if raw.startswith("/view?") or "/view?" in raw:
            query = urlparse(raw).query if "?" in raw else raw.split("?", 1)[1]
            parsed = parse_qs(query)
            filename = (parsed.get("filename", [""])[0] or "").strip()
            if not filename:
                return None
            return {
                "filename": filename,
                "subfolder": (parsed.get("subfolder", [""])[0] or "").strip(),
                "type": (parsed.get("type", ["output"])[0] or "output").strip(),
            }

        norm = os.path.normpath(raw)
        base_checks = []
        if self.output_dir:
            base_checks.append(("output", os.path.normpath(self.output_dir)))
        if self.temp_dir:
            base_checks.append(("temp", os.path.normpath(self.temp_dir)))

        # Absolute path from nodes like VHS_SelectFilename.
        if os.path.isabs(norm):
            for media_type, base_dir in base_checks:
                try:
                    if os.path.commonpath([norm, base_dir]) == base_dir:
                        rel = os.path.relpath(norm, base_dir)
                        subfolder, filename = os.path.split(rel)
                        return {
                            "filename": filename,
                            "subfolder": subfolder.replace("\\", "/"),
                            "type": media_type,
                        }
                except ValueError:
                    continue

        # Relative path support: try output then temp.
        candidate_rel = norm.lstrip("\\/").replace("\\", "/")
        for media_type, base_dir in base_checks:
            candidate_abs = os.path.normpath(os.path.join(base_dir, candidate_rel))
            try:
                if os.path.commonpath([candidate_abs, base_dir]) == base_dir and os.path.exists(candidate_abs):
                    subfolder, filename = os.path.split(candidate_rel)
                    return {
                        "filename": filename,
                        "subfolder": subfolder.replace("\\", "/"),
                        "type": media_type,
                    }
            except ValueError:
                continue

        # Final fallback: treat input as a plain output filename.
        subfolder, filename = os.path.split(candidate_rel)
        if not filename:
            return None
        return {
            "filename": filename,
            "subfolder": subfolder.replace("\\", "/"),
            "type": "output",
        }

    def preview_video(self, video_path, run_id=""):
        payload = self._normalize_view_payload(video_path)
        if not payload:
            print(f"CozyGen: CozyGenVideoPreviewOutput could not parse video_path='{video_path}'")
            return {"ui": {"videos": []}}

        video_url = f"/view?filename={payload['filename']}&subfolder={payload['subfolder']}&type={payload['type']}"
        message_data = {
            "status": "video_generated",
            "video_url": video_url,
            "filename": payload["filename"],
            "subfolder": payload["subfolder"],
            "type": payload["type"],
        }

        server_instance = server.PromptServer.instance
        if server_instance:
            server_instance.send_sync("cozygen_video_ready", message_data)
            print(f"CozyGen: Sent custom WebSocket message: {{'type': 'cozygen_video_ready', 'data': {message_data}}}")

        return {"ui": {"videos": [payload]}}

import comfy.samplers
import comfy.sample

# Dynamically get model folder names
models_path = folder_paths.models_dir
model_folders = sorted([d.name for d in os.scandir(models_path) if d.is_dir()])
static_choices = ["sampler", "scheduler"]
all_choice_types = model_folders + static_choices
MAX_SEED_NUM = 1125899906842624


def _get_choice_values(choice_type):
    if choice_type == "sampler":
        return list(comfy.samplers.KSampler.SAMPLERS)
    if choice_type == "scheduler":
        return list(comfy.samplers.KSampler.SCHEDULERS)
    try:
        return list(folder_paths.get_filename_list(choice_type))
    except KeyError:
        return []

class CozyGenFloatInput:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "param_name": (IO.STRING, {"default": "Float Parameter"}),
                "priority": (IO.INT, {"default": 10}),
                "default_value": (IO.FLOAT, {"default": 1.0}),
                "min_value": (IO.FLOAT, {"default": 0.0}),
                "max_value": (IO.FLOAT, {"default": 1024.0}),
                "step": (IO.FLOAT, {"default": 0.1}),
                "add_randomize_toggle": (IO.BOOLEAN, {"default": False}),
            }
        }
    
    RETURN_TYPES = (IO.FLOAT,)
    FUNCTION = "get_value"
    CATEGORY = "CozyGen/Static"
    def get_value(self, param_name, priority, default_value, min_value, max_value, step, add_randomize_toggle):
        return (default_value,)

class CozyGenIntInput:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "param_name": (IO.STRING, {"default": "Int Parameter"}),
                "priority": (IO.INT, {"default": 10}),
                "default_value": (IO.INT, {"default": 1, "min": -9999999999, "max": 9999999999, "step": 1}),
                "min_value": (IO.INT, {"default": 0}),
                "max_value": (IO.INT, {"default": 9999999999, "max": 9999999999}),
                "step": (IO.INT, {"default": 1}),
                "add_randomize_toggle": (IO.BOOLEAN, {"default": False}),
            }
        }
    
    RETURN_TYPES = (IO.INT,)
    FUNCTION = "get_value"
    CATEGORY = "CozyGen/Static"
    def get_value(self, param_name, priority, default_value, min_value, max_value, step, add_randomize_toggle):
        return (default_value,)

class CozyGenSeedInput:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "param_name": (IO.STRING, {"default": "Seed"}),
                "priority": (IO.INT, {"default": 10}),
                "seed": (IO.INT, {"default": 0, "min": 0, "max": MAX_SEED_NUM}),
                "min_value": (IO.INT, {"default": 0, "min": 0, "max": MAX_SEED_NUM}),
                "max_value": (IO.INT, {"default": MAX_SEED_NUM, "min": 0, "max": MAX_SEED_NUM}),
                "add_randomize_toggle": (IO.BOOLEAN, {"default": True}),
            }
        }

    RETURN_TYPES = (IO.INT,)
    RETURN_NAMES = ("seed",)
    FUNCTION = "get_value"
    CATEGORY = "CozyGen/Static"

    def get_value(self, param_name, priority, seed, min_value, max_value, add_randomize_toggle):
        if max_value < min_value:
            min_value, max_value = max_value, min_value
        seed = max(min_value, min(max_value, int(seed)))
        return (seed,)


class _CozyGenRandomNoise:
    def __init__(self, seed):
        self.seed = seed

    def generate_noise(self, input_latent):
        latent_image = input_latent["samples"]
        batch_inds = input_latent["batch_index"] if "batch_index" in input_latent else None
        return comfy.sample.prepare_noise(latent_image, self.seed, batch_inds)


class CozyGenRandomNoiseInput:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "param_name": (IO.STRING, {"default": "Noise Seed"}),
                "priority": (IO.INT, {"default": 10}),
                "noise_seed": (IO.INT, {"default": 0, "min": 0, "max": MAX_SEED_NUM, "control_after_generate": True}),
                "min_value": (IO.INT, {"default": 0, "min": 0, "max": MAX_SEED_NUM}),
                "max_value": (IO.INT, {"default": MAX_SEED_NUM, "min": 0, "max": MAX_SEED_NUM}),
                "add_randomize_toggle": (IO.BOOLEAN, {"default": True}),
            }
        }

    RETURN_TYPES = ("NOISE",)
    RETURN_NAMES = ("noise",)
    FUNCTION = "get_noise"
    CATEGORY = "CozyGen/Static"

    def get_noise(self, param_name, priority, noise_seed, min_value, max_value, add_randomize_toggle):
        if max_value < min_value:
            min_value, max_value = max_value, min_value
        seed = max(min_value, min(max_value, int(noise_seed)))
        return (_CozyGenRandomNoise(seed),)

class CozyGenStringInput:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "param_name": (IO.STRING, {"default": "String Parameter"}),
                "priority": (IO.INT, {"default": 10}),
                "default_value": (IO.STRING, { "default": "", "multiline": True }),
                "display_multiline": (IO.BOOLEAN, {"default": False}),
            }
        }
    
    RETURN_TYPES = (IO.STRING,)
    FUNCTION = "get_value"
    CATEGORY = "CozyGen/Static"
    def get_value(self, param_name, priority, default_value, display_multiline):
        return (default_value,)

class CozyGenChoiceInput:
    _NODE_CLASS_NAME = "CozyGenChoiceInput"
    @classmethod
    def INPUT_TYPES(cls):
        # Create a flat list of all possible choices for the initial dropdown
        all_choices = []
        for choice_type in all_choice_types:
            if choice_type == "sampler":
                all_choices.extend(comfy.samplers.KSampler.SAMPLERS)
            elif choice_type == "scheduler":
                all_choices.extend(comfy.samplers.KSampler.SCHEDULERS)
            else:
                try:
                    all_choices.extend(folder_paths.get_filename_list(choice_type))
                except KeyError:
                    pass # Ignore choice types that don't have a corresponding folder
        # Add a "None" option to be safe
        all_choices = ["None"] + sorted(list(set(all_choices)))

        return {
            "required": {
                "param_name": (IO.STRING, {"default": "Choice Parameter"}),
                "priority": (IO.INT, {"default": 10}),
                "choice_type": (all_choice_types,),
                "default_choice": (all_choices,),
                "display_bypass": (IO.BOOLEAN, {"default": False}),
            },
            "hidden": {
                "value": (IO.STRING, { "default": "" }) # This is the value from the web UI
            }
        }

    RETURN_TYPES = (node_typing.IO.ANY,)
    FUNCTION = "get_value"
    CATEGORY = "CozyGen/Static"

    def get_value(self, param_name, priority, choice_type, default_choice, display_bypass, value):
        # The `value` parameter comes from the frontend UI on generation.
        # If it's present, we use it. Otherwise, we use the default set in the node graph.
        final_value = value if value and value != "None" else default_choice
        choices = _get_choice_values(choice_type)

        # Keep final value aligned with selected choice_type.
        if choices:
            if not final_value or final_value == "None" or final_value not in choices:
                return (choices[0],)
        elif not final_value:
            return ("None",)

        return (final_value,)

class CozyGenLoraInput:
    _NODE_CLASS_NAME = "CozyGenLoraInput"
    
    @classmethod
    def get_choices(cls):
        lora_files = [
            f for f in folder_paths.get_filename_list("loras")
            if f.endswith((".safetensors", ".pt", ".ckpt")) and not f.startswith("hidden/")
        ]
        return ["None"] + sorted(lora_files)

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "param_name": (IO.STRING, {"default": "Lora Selector"}),
                "priority": (IO.INT, {"default": 10}),
                "lora_value": (CozyGenLoraInput.get_choices(), {
                    "default": "None",
                    "tooltip": "Select LoRA — output is STRING; connect to WanVideo lora_N (combo). Restart ComfyUI if wire won't light up.",
                }),
                "strength_value": (IO.FLOAT, {
                    "default": 1.0, "min": -5.0, "max": 5.0, "step": 0.05,
                    "tooltip": "LoRA strength.",
                }),
            },
        }

    RETURN_TYPES = (IO.ANY, IO.FLOAT)
    RETURN_NAMES = ("lora", "strength")
    FUNCTION = "get_value"
    CATEGORY = "CozyGen"
    DESCRIPTION = "Select LoRA name → STRING output connects to WanVideoLoraSelectMulti lora_N slots."

    def get_value(self, param_name, priority, lora_value, strength_value):
        if lora_value not in CozyGenLoraInput.get_choices() or lora_value == "None":
            return ("none", 0.0)  # lowercase "none" matches WanVideo default
        return (lora_value, float(strength_value))

class CozyGenLoraInputMulti:
    _NODE_CLASS_NAME = "CozyGenLoraInputMulti"

    @classmethod
    def get_choices(cls):
        lora_files = [
            f for f in folder_paths.get_filename_list("loras")
            if f.endswith((".safetensors", ".pt", ".ckpt")) and not f.startswith("hidden/")
        ]
        return ["None"] + sorted(lora_files)

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "param_name": (IO.STRING, {"default": "Lora Selector (Multi)"}),
                "priority": (IO.INT, {"default": 10}),
                "lora_0": (CozyGenLoraInputMulti.get_choices(), {
                    "default": "None",
                    "tooltip": "Outputs COMBO-compatible LoRA names — wires directly to WanVideoLoraSelectMulti lora_N.",
                }),
                "strength_0": (IO.FLOAT, {
                    "default": 1.0,
                    "min": -5.0,
                    "max": 5.0,
                    "step": 0.05,
                    "tooltip": "Connect each lora_N → WanVideo lora_N and strength_N → strength_N directly (no loading here).",
                }),
                "lora_1": (CozyGenLoraInputMulti.get_choices(), {
                    "default": "None",
                    "tooltip": "Outputs COMBO-compatible LoRA names — wires directly to WanVideoLoraSelectMulti lora_N.",
                }),
                "strength_1": (IO.FLOAT, {
                    "default": 1.0,
                    "min": -5.0,
                    "max": 5.0,
                    "step": 0.05,
                    "tooltip": "Connect each lora_N → WanVideo lora_N and strength_N → strength_N directly (no loading here).",
                }),
                "lora_2": (CozyGenLoraInputMulti.get_choices(), {
                    "default": "None",
                    "tooltip": "Outputs COMBO-compatible LoRA names — wires directly to WanVideoLoraSelectMulti lora_N.",
                }),
                "strength_2": (IO.FLOAT, {
                    "default": 1.0,
                    "min": -5.0,
                    "max": 5.0,
                    "step": 0.05,
                    "tooltip": "Connect each lora_N → WanVideo lora_N and strength_N → strength_N directly (no loading here).",
                }),
                "lora_3": (CozyGenLoraInputMulti.get_choices(), {
                    "default": "None",
                    "tooltip": "Outputs COMBO-compatible LoRA names — wires directly to WanVideoLoraSelectMulti lora_N.",
                }),
                "strength_3": (IO.FLOAT, {
                    "default": 1.0,
                    "min": -5.0,
                    "max": 5.0,
                    "step": 0.05,
                    "tooltip": "Connect each lora_N → WanVideo lora_N and strength_N → strength_N directly (no loading here).",
                }),
                "lora_4": (CozyGenLoraInputMulti.get_choices(), {
                    "default": "None",
                    "tooltip": "Outputs COMBO-compatible LoRA names — wires directly to WanVideoLoraSelectMulti lora_N.",
                }),
                "strength_4": (IO.FLOAT, {
                    "default": 1.0,
                    "min": -5.0,
                    "max": 5.0,
                    "step": 0.05,
                    "tooltip": "Connect each lora_N → WanVideo lora_N and strength_N → strength_N directly (no loading here).",
                }),
            },
        }

    RETURN_TYPES = (
        IO.ANY, IO.FLOAT,
        IO.ANY, IO.FLOAT,
        IO.ANY, IO.FLOAT,
        IO.ANY, IO.FLOAT,
        IO.ANY, IO.FLOAT,
    )
    RETURN_NAMES = (
        "lora_0", "strength_0", "lora_1", "strength_1",
        "lora_2", "strength_2", "lora_3", "strength_3",
        "lora_4", "strength_4",
    )
    FUNCTION = "get_value"
    CATEGORY = "CozyGen"
    DESCRIPTION = "Select LoRAs → STRING outputs connect directly to WanVideo lora_N slots."

    def get_value(self, param_name, priority, lora_0, strength_0, lora_1, strength_1, lora_2, strength_2, lora_3, strength_3, lora_4, strength_4):
        lora_inputs = [(lora_0, strength_0), (lora_1, strength_1), (lora_2, strength_2), (lora_3, strength_3), (lora_4, strength_4)]
        output = []
        valid = CozyGenLoraInputMulti.get_choices()
        for name, stren in lora_inputs:
            if name not in valid or name == "None" or stren == 0:
                output.extend(["none", 0.0])
            else:
                output.extend([name, float(stren)])
        return tuple(output)

class CozyGenWanVideoModelSelector:
    _NODE_CLASS_NAME = "CozyGenWanVideoModelSelector"

    @classmethod
    def get_model_choices(cls):
        unet_models = folder_paths.get_filename_list("unet_gguf")
        diffusion_models = folder_paths.get_filename_list("diffusion_models")
        combined = [*unet_models, *diffusion_models]
        if not combined:
            return ["none"]
        return combined

    @classmethod
    def INPUT_TYPES(cls):
        model_choices = CozyGenWanVideoModelSelector.get_model_choices()
        return {
            "required": {
                "param_name": (IO.STRING, {"default": "WanVideo Model Selector"}),
                "priority": (IO.INT, {"default": 10}),
                "model_name": (model_choices, {
                    "default": model_choices[0] if model_choices else "none",
                    "tooltip": "WanVideo model file from unet_gguf or diffusion_models.",
                }),
                "base_precision": (["fp32", "bf16", "fp16", "fp16_fast"], {
                    "default": "bf16",
                    "tooltip": "Base precision for loading the model weights.",
                }),
                "quantization": ([
                    "disabled",
                    "fp8_e4m3fn",
                    "fp8_e4m3fn_fast",
                    "fp8_e4m3fn_scaled",
                    "fp8_e4m3fn_scaled_fast",
                    "fp8_e5m2",
                    "fp8_e5m2_fast",
                    "fp8_e5m2_scaled",
                    "fp8_e5m2_scaled_fast",
                ], {
                    "default": "disabled",
                    "tooltip": "Optional FP8 quantization mode for WanVideo models.",
                }),
                "load_device": (["main_device", "offload_device"], {
                    "default": "offload_device",
                    "tooltip": "Select whether to load on the main device or offload device.",
                }),
            },
        }

    RETURN_TYPES = (IO.ANY, IO.ANY, IO.ANY, IO.ANY)
    RETURN_NAMES = ("model_name", "base_precision", "quantization", "load_device")
    FUNCTION = "get_value"
    CATEGORY = "CozyGen"
    DESCRIPTION = "Select WanVideo model params — outputs connect directly to WanVideoModelLoader inputs."

    def get_value(self, param_name, priority, model_name, base_precision, quantization, load_device):
        model_choices = CozyGenWanVideoModelSelector.get_model_choices()
        final_model = model_name if model_name in model_choices else "none"
        return (str(final_model), str(base_precision), str(quantization), str(load_device))

class CozyGenMetaText(ComfyNodeABC):
    _NODE_CLASS_NAME = "CozyGenMetaText"
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "hidden": {
                "value": (IO.STRING, {"default": ""})
            }
        }
        
    RETURN_TYPES = (IO.STRING,)
    RETURN_NAMES = ("metadata",)
    FUNCTION = "get_value"
    CATEGORY = "CozyGen/Static"
    
    def get_value(self, value=""):
        return (value,)

NODE_CLASS_MAPPINGS = {
    "CozyGenOutput": CozyGenOutput,
    "CozyGenVideoOutput": CozyGenVideoOutput,
    "CozyGenVideoPreviewOutput": CozyGenVideoPreviewOutput,
    "CozyGenDynamicInput": CozyGenDynamicInput,
    "CozyGenImageInput": CozyGenImageInput,
    "CozyGenFloatInput": CozyGenFloatInput,
    "CozyGenIntInput": CozyGenIntInput,
    "CozyGenSeedInput": CozyGenSeedInput,
    "CozyGenRandomNoiseInput": CozyGenRandomNoiseInput,
    "CozyGenStringInput": CozyGenStringInput,
    "CozyGenChoiceInput": CozyGenChoiceInput,
    "CozyGenLoraInput": CozyGenLoraInput,
    "CozyGenLoraInputMulti": CozyGenLoraInputMulti,
    "CozyGenWanVideoModelSelector": CozyGenWanVideoModelSelector,
    "CozyGenMetaText": CozyGenMetaText,
    "CozyGenBoolInput": CozyGenBoolInput
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CozyGenOutput": "CozyGen Output",
    "CozyGenVideoOutput": "CozyGen Video Output",
    "CozyGenVideoPreviewOutput": "CozyGen Video Preview Output",
    "CozyGenDynamicInput": "CozyGen Dynamic Input",
    "CozyGenImageInput": "CozyGen Image Input",
    "CozyGenFloatInput": "CozyGen Float Input",
    "CozyGenIntInput": "CozyGen Int Input",
    "CozyGenSeedInput": "CozyGen Seed Input",
    "CozyGenRandomNoiseInput": "CozyGen Random Noise Input",
    "CozyGenStringInput": "CozyGen String Input",
    "CozyGenChoiceInput": "CozyGen Choice Input",
    "CozyGenLoraInput": "CozyGen Lora Input",
    "CozyGenLoraInputMulti": "CozyGen Lora Input Multi",
    "CozyGenWanVideoModelSelector": "CozyGen WanVideo Model Selector",
    "CozyGenMetaText": "CozyGen Meta Text",
    "CozyGenBoolInput": "CozyGen Bool Input"
}
