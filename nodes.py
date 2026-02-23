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
import comfy.model_management



class _CozyGenDynamicTypes(str):
    basic_types = node_typing.IO.PRIMITIVE.split(",")

    def __eq__(self, other):
        return other in self.basic_types or isinstance(other, (list, _CozyGenDynamicTypes))

    def __ne__(self, other):
        return not self.__eq__(other)

CozyGenDynamicTypes = _CozyGenDynamicTypes("COZYGEN_DYNAMIC_TYPE")


class _CozyGenAnyType(str):
    def __ne__(self, __value: object) -> bool:
        return False


CozyGenAnyType = _CozyGenAnyType("*")


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


class CozyGenConditionalInterrupt:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "input": (CozyGenAnyType,),
                "proceed": (IO.BOOLEAN, {"default": True}),
            },
        }

    @classmethod
    def VALIDATE_INPUTS(cls, input_types):
        return True

    RETURN_TYPES = (CozyGenAnyType,)
    RETURN_NAMES = ("output",)
    FUNCTION = "route_or_interrupt"
    CATEGORY = "CozyGen/Flow"

    def route_or_interrupt(self, input, proceed):
        if not proceed:
            raise comfy.model_management.InterruptProcessingException()
        return (input,)


class CozyGenEnd:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "input": (CozyGenAnyType,),
            },
            "hidden": {
                "run_id": (IO.STRING, {"default": ""}),
            },
        }

    @classmethod
    def VALIDATE_INPUTS(cls, input_types):
        return True

    RETURN_TYPES = ()
    FUNCTION = "end"
    OUTPUT_NODE = True
    CATEGORY = "CozyGen/Flow"

    def end(self, input, run_id=""):
        message_data = {
            "status": "finished",
            "run_id": run_id,
        }
        server_instance = server.PromptServer.instance
        if server_instance:
            server_instance.send_sync("cozygen_run_end", message_data)
            print(f"CozyGen: Sent custom WebSocket message: {{'type': 'cozygen_run_end', 'data': {message_data}}}")
        return {}


class CozyGenPriorityManager:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "manage"
    CATEGORY = "CozyGen/Flow"

    def manage(self):
        return ()


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
    _VIDEO_EXTENSIONS = (".mp4", ".webm", ".mkv", ".mov", ".avi")
    _IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff")

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

    def _promote_sidecar_video_payload(self, payload):
        if not payload:
            return payload

        filename = str(payload.get("filename", "")).strip()
        if not filename:
            return payload

        lower_name = filename.lower()
        if lower_name.endswith(self._VIDEO_EXTENSIONS):
            return payload
        if not lower_name.endswith(self._IMAGE_EXTENSIONS):
            return payload

        media_type = payload.get("type", "output")
        if media_type == "temp":
            base_dir = self.temp_dir
        else:
            base_dir = self.output_dir
        if not base_dir:
            return payload

        subfolder = str(payload.get("subfolder", "")).replace("/", os.sep).replace("\\", os.sep)
        target_dir = os.path.normpath(os.path.join(base_dir, subfolder))
        stem = os.path.splitext(filename)[0]

        for ext in self._VIDEO_EXTENSIONS:
            candidate = stem + ext
            candidate_path = os.path.join(target_dir, candidate)
            if os.path.exists(candidate_path):
                next_payload = dict(payload)
                next_payload["filename"] = candidate
                return next_payload

        return payload

    def preview_video(self, video_path, run_id=""):
        payload = self._normalize_view_payload(video_path)
        payload = self._promote_sidecar_video_payload(payload)
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


class CozyGenVideoPreviewOutputMulti(CozyGenVideoPreviewOutput):
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "param_name": (IO.STRING, {"default": "Video Preview"}),
                "priority": (IO.INT, {"default": 10}),
                "enabled": (IO.BOOLEAN, {"default": True}),
                "video_path": (IO.STRING, {"default": ""}),
            },
            "optional": {
                "filenames": (CozyGenAnyType,),
            },
            "hidden": {
                "run_id": (IO.STRING, {"default": ""}),
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "preview_video"
    OUTPUT_NODE = True
    CATEGORY = "CozyGen"

    def _collect_candidate_video_paths(self, video_path="", filenames=None):
        collected = []

        def add_candidate(value):
            if value is None:
                return
            if isinstance(value, (str, bytes, os.PathLike)):
                text = str(value).strip()
                if text:
                    collected.append(text)
                return
            if isinstance(value, dict):
                fullpath = value.get("fullpath")
                if fullpath:
                    add_candidate(fullpath)
                    return
                filename = value.get("filename")
                if filename:
                    subfolder = str(value.get("subfolder", "")).strip()
                    if subfolder:
                        collected.append(f"{subfolder}/{filename}".replace("\\", "/"))
                    else:
                        collected.append(str(filename))
                return
            if isinstance(value, tuple) and len(value) == 2 and isinstance(value[0], bool):
                # VHS_VideoCombine returns (save_output: bool, output_files: list[str])
                add_candidate(value[1])
                return
            if isinstance(value, (list, tuple, set)):
                for item in value:
                    add_candidate(item)
                return

        add_candidate(video_path)
        add_candidate(filenames)

        deduped = []
        seen = set()
        for path in collected:
            norm = str(path).strip()
            if not norm or norm in seen:
                continue
            seen.add(norm)
            deduped.append(norm)
        return deduped

    def preview_video(self, param_name, priority, enabled, video_path, filenames=None, run_id=""):
        candidate_paths = self._collect_candidate_video_paths(video_path, filenames)

        payloads = []
        seen_payload_keys = set()
        for candidate in candidate_paths:
            payload = self._normalize_view_payload(candidate)
            payload = self._promote_sidecar_video_payload(payload)
            if not payload:
                continue
            payload_key = (payload.get("type", "output"), payload.get("subfolder", ""), payload.get("filename", ""))
            if payload_key in seen_payload_keys:
                continue
            seen_payload_keys.add(payload_key)
            payloads.append(payload)

        if not payloads:
            print(
                "CozyGen: CozyGenVideoPreviewOutputMulti could not parse any video path "
                f"from video_path='{video_path}'"
            )
            return {"ui": {"videos": []}}

        preview_name = str(param_name).strip() if param_name is not None else ""
        if not preview_name:
            preview_name = "Video Preview"
        try:
            preview_priority = int(priority)
        except (TypeError, ValueError):
            preview_priority = 10

        server_instance = server.PromptServer.instance
        if enabled and server_instance:
            for order_index, payload in enumerate(payloads):
                preview_key = (
                    f"{preview_name}:{preview_priority}:{order_index}:"
                    f"{payload['subfolder']}/{payload['filename']}"
                )
                video_url = (
                    f"/view?filename={payload['filename']}"
                    f"&subfolder={payload['subfolder']}"
                    f"&type={payload['type']}"
                )
                message_data = {
                    "status": "video_generated",
                    "video_url": video_url,
                    "filename": payload["filename"],
                    "subfolder": payload["subfolder"],
                    "type": payload["type"],
                    "param_name": preview_name,
                    "priority": preview_priority,
                    "order": order_index,
                    "preview_key": preview_key,
                }
                server_instance.send_sync("cozygen_video_ready", message_data)
                print(
                    "CozyGen: Sent custom WebSocket message: "
                    f"{{'type': 'cozygen_video_ready', 'data': {message_data}}}"
                )

        return {"ui": {"videos": payloads}}

import comfy.samplers
import comfy.sample

# Dynamically get model folder names
models_path = folder_paths.models_dir
model_folders = sorted([d.name for d in os.scandir(models_path) if d.is_dir()])
static_choices = ["sampler", "scheduler"]
all_choice_types = model_folders + static_choices
MAX_SEED_NUM = 1125899906842624


def _get_choice_values(choice_type):
    resolved_choice_type = choice_type
    # Keep runtime resolution aligned with /cozygen/get_choices for legacy workflows.
    if choice_type == "unet" and "unet_gguf" in folder_paths.folder_names_and_paths:
        resolved_choice_type = "unet_gguf"

    raw_choices = []
    if resolved_choice_type == "sampler":
        raw_choices = list(comfy.samplers.KSampler.SAMPLERS)
    elif resolved_choice_type == "scheduler":
        raw_choices = list(comfy.samplers.KSampler.SCHEDULERS)
    else:
        try:
            raw_choices = list(folder_paths.get_filename_list(resolved_choice_type))
        except KeyError:
            raw_choices = []

    canonical = []
    seen = set()
    for choice in raw_choices:
        choice_str = str(choice)
        choice_norm = _normalize_choice_value(choice_str)
        if choice_norm in seen:
            continue
        seen.add(choice_norm)
        canonical.append(choice_str)
    return canonical


def _normalize_choice_value(value):
    if value is None:
        return ""
    return str(value).strip().replace("\\", "/")

class CozyGenFloatInput:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "param_name": (IO.STRING, {"default": "Float Parameter"}),
                "priority": (IO.INT, {"default": 10}),
                "default_value": (IO.FLOAT, {"default": 1.0, "step": 0.01, "round": 0.01}),
                "min_value": (IO.FLOAT, {"default": 0.0, "step": 0.01, "round": 0.01}),
                "max_value": (IO.FLOAT, {"default": 1024.0, "step": 0.01, "round": 0.01}),
                "step": (IO.FLOAT, {"default": 0.01, "step": 0.01, "round": 0.01}),
                "add_randomize_toggle": (IO.BOOLEAN, {"default": False}),
            }
        }
    
    RETURN_TYPES = (IO.FLOAT,)
    FUNCTION = "get_value"
    CATEGORY = "CozyGen/Static"
    def get_value(self, param_name, priority, default_value, min_value, max_value, step, add_randomize_toggle):
        return (round(float(default_value), 2),)

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
        return {
            "required": {
                "param_name": (IO.STRING, {"default": "Choice Parameter"}),
                "priority": (IO.INT, {"default": 10}),
                "choice_type": (all_choice_types,),
                # Keep this as STRING so stale graph values don't fail pre-execution validation.
                "default_choice": (IO.STRING, {"default": "None"}),
                "display_bypass": (IO.BOOLEAN, {"default": False}),
            },
            "hidden": {
                "value": (IO.STRING, { "default": "" }) # This is the value from the web UI
            }
        }

    RETURN_TYPES = (node_typing.IO.ANY,)
    FUNCTION = "get_value"
    CATEGORY = "CozyGen/Static"

    def get_value(self, param_name, priority, choice_type, default_choice, display_bypass, value=""):
        # The `value` parameter comes from the frontend UI on generation.
        # If it's present, we use it. Otherwise, we use the default set in the node graph.
        final_value = value if value and value != "None" else default_choice
        choices = _get_choice_values(choice_type)
        final_value_norm = _normalize_choice_value(final_value)

        # Keep final value aligned with selected choice_type.
        if choices:
            normalized_choices = {_normalize_choice_value(c): c for c in choices}
            if final_value in choices:
                return (final_value,)
            if final_value_norm in normalized_choices:
                return (normalized_choices[final_value_norm],)
            if not final_value or final_value == "None":
                return (choices[0],)
        elif not final_value:
            return ("None",)

        return (str(final_value),)

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
    MAX_LORAS = 5

    @classmethod
    def get_choices(cls):
        lora_files = [
            f for f in folder_paths.get_filename_list("loras")
            if f.endswith((".safetensors", ".pt", ".ckpt")) and not f.startswith("hidden/")
        ]
        return ["None"] + sorted(lora_files)

    @classmethod
    def INPUT_TYPES(cls):
        required = {
            "param_name": (IO.STRING, {"default": "Lora Selector (Multi)"}),
            "priority": (IO.INT, {"default": 10}),
            "num_loras": (IO.INT, {
                "default": cls.MAX_LORAS,
                "min": 1,
                "max": cls.MAX_LORAS,
                "step": 1,
                "tooltip": "How many LoRAs are active.",
            }),
        }

        for index in range(cls.MAX_LORAS):
            required[f"lora_{index}"] = (CozyGenLoraInputMulti.get_choices(), {
                "default": "None",
                "tooltip": "Select a LoRA to include in the LORA_STACK output.",
            })
            required[f"strength_{index}"] = (IO.FLOAT, {
                "default": 1.0,
                "min": -5.0,
                "max": 5.0,
                "step": 0.05,
                "tooltip": "Applied to both model and clip strength in the output stack.",
            })

        return {
            "required": required,
        }

    RETURN_TYPES = ("LORA_STACK",)
    RETURN_NAMES = ("lora_stack",)
    FUNCTION = "get_value"
    CATEGORY = "CozyGen"
    DESCRIPTION = "Select LoRAs and output one LORA_STACK."

    def get_value(self, param_name, priority, num_loras=5, **kwargs):
        valid = set(CozyGenLoraInputMulti.get_choices())
        active_count = max(1, min(self.MAX_LORAS, int(num_loras)))
        lora_stack = []

        for idx in range(active_count):
            lora_name = kwargs.get(f"lora_{idx}", "None")
            strength = float(kwargs.get(f"strength_{idx}", 1.0))
            if lora_name not in valid or lora_name == "None" or strength == 0:
                continue
            # EasyUse shape: (lora_name, model_strength, clip_strength)
            lora_stack.append((lora_name, strength, strength))

        return (lora_stack,)

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
    "CozyGenVideoPreviewOutputMulti": CozyGenVideoPreviewOutputMulti,
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
    "CozyGenBoolInput": CozyGenBoolInput,
    "CozyGenConditionalInterrupt": CozyGenConditionalInterrupt,
    "CozyGenEnd": CozyGenEnd,
    "CozyGenPriorityManager": CozyGenPriorityManager
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CozyGenOutput": "CozyGen Output",
    "CozyGenVideoOutput": "CozyGen Video Output",
    "CozyGenVideoPreviewOutput": "CozyGen Video Preview Output",
    "CozyGenVideoPreviewOutputMulti": "CozyGen Video Preview Output Multi",
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
    "CozyGenBoolInput": "CozyGen Bool Input",
    "CozyGenConditionalInterrupt": "CozyGen Conditional Interrupt",
    "CozyGenEnd": "CozyGen End",
    "CozyGenPriorityManager": "CozyGen Priority Manager"
}

