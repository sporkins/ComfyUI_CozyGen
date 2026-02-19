from aiohttp import web
import os
import json
import io
import functools
import folder_paths
from PIL import Image, ImageOps
import server # Import server for node_info
import uuid # For generating unique filenames
import re

MODULE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_WORKFLOWS_DIR = os.path.join(MODULE_DIR, ".workflows")
DEFAULT_CACHE_DIR = os.path.join(MODULE_DIR, ".cache")
CONFIG_FILENAME = "config.json"

def get_config() -> dict:
    config_path = os.path.join(MODULE_DIR, CONFIG_FILENAME)
    if not os.path.exists(config_path):
        return {}
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}

def get_workflows_dir() -> str:
    config = get_config()
    workflows_dir = config.get("workflows_dir")
    if not workflows_dir:
        return DEFAULT_WORKFLOWS_DIR
    resolved = os.path.expandvars(os.path.expanduser(str(workflows_dir)))
    if not os.path.isabs(resolved):
        resolved = os.path.normpath(os.path.join(MODULE_DIR, resolved))
    return resolved

def get_cache_dir() -> str:
    config = get_config()
    cache_dir = config.get("cache_dir")
    if not cache_dir:
        return DEFAULT_CACHE_DIR
    resolved = os.path.expandvars(os.path.expanduser(str(cache_dir)))
    if not os.path.isabs(resolved):
        resolved = os.path.normpath(os.path.join(MODULE_DIR, resolved))
    return resolved

def get_base_dir_for_type(file_type: str) -> str | None:
    if file_type == "output":
        return folder_paths.get_output_directory()
    if file_type == "input":
        return folder_paths.get_input_directory()
    if file_type == "temp":
        get_temp = getattr(folder_paths, "get_temp_directory", None)
        return get_temp() if callable(get_temp) else None
    return None

def normalize_media_path(base_dir: str, subfolder: str, filename: str) -> str | None:
    if not base_dir:
        return None
    base_dir = os.path.normpath(base_dir)
    target_path = os.path.normpath(os.path.join(base_dir, subfolder, filename))
    try:
        base_cmp = os.path.normcase(base_dir)
        target_cmp = os.path.normcase(target_path)
        if os.path.commonpath([base_cmp, target_cmp]) != base_cmp:
            return None
    except Exception:
        return None
    return target_path

def get_history_dir() -> str:
    history_dir = os.path.join(get_cache_dir(), "history")
    os.makedirs(history_dir, exist_ok=True)
    return history_dir

def sanitize_history_id(history_id: str) -> str:
    return re.sub(r'[^a-zA-Z0-9._-]', '_', history_id or '')

def history_path_for_id(history_id: str) -> str:
    safe_id = sanitize_history_id(history_id)
    return os.path.join(get_history_dir(), f"{safe_id}.json")

def load_history_entry(history_id: str):
    path = history_path_for_id(history_id)
    if not os.path.exists(path):
        return None
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def write_history_entry(history_id: str, data: dict):
    path = history_path_for_id(history_id)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

def list_history_entries():
    history_dir = get_history_dir()
    entries = []
    for name in os.listdir(history_dir):
        if not name.endswith('.json'):
            continue
        path = os.path.join(history_dir, name)
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            entries.append(data)
        except Exception:
            continue
    entries.sort(key=lambda item: item.get("timestamp", ""), reverse=True)
    return entries

def get_session_path() -> str:
    cache_dir = get_cache_dir()
    os.makedirs(cache_dir, exist_ok=True)
    return os.path.join(cache_dir, "session.json")

def load_session():
    path = get_session_path()
    if not os.path.exists(path):
        return None
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def write_session(data: dict):
    path = get_session_path()
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

@functools.lru_cache(maxsize=256)
def build_thumbnail_bytes(path: str, mtime: float, size: int, width: int, quality: int, fmt: str):
    with Image.open(path) as img:
        img = ImageOps.exif_transpose(img)
        if getattr(img, "is_animated", False):
            try:
                img.seek(0)
            except Exception:
                pass

        if width and img.width > width:
            target_height = max(1, int((img.height / img.width) * width))
            img = img.resize((width, target_height), resample=Image.LANCZOS)

        if fmt == "webp":
            try:
                buffer = io.BytesIO()
                img.save(buffer, format="WEBP", quality=quality, method=4)
                return buffer.getvalue(), "image/webp"
            except Exception:
                fmt = "jpeg"

        if fmt in ("jpeg", "jpg"):
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=quality, optimize=True)
            return buffer.getvalue(), "image/jpeg"

        if fmt == "png":
            buffer = io.BytesIO()
            img.save(buffer, format="PNG", optimize=True)
            return buffer.getvalue(), "image/png"

    raise ValueError("Unsupported format")

async def get_hello(request: web.Request) -> web.Response:
    return web.json_response({"status": "success", "message": "Hello from the CozyGen API!"})

async def get_gallery_files(request: web.Request) -> web.Response:
    subfolder = request.rel_url.query.get('subfolder', '')
    try:
        page = int(request.rel_url.query.get('page', '1'))
        per_page = int(request.rel_url.query.get('per_page', '20'))
    except ValueError:
        return web.json_response({"error": "Invalid page or per_page parameter"}, status=400)

    output_directory = folder_paths.get_output_directory()

    # Security: Prevent directory traversal
    gallery_path = os.path.normpath(os.path.join(output_directory, subfolder))
    if not gallery_path.startswith(output_directory):
        return web.json_response({"error": "Unauthorized path"}, status=403)

    if not os.path.exists(gallery_path) or not os.path.isdir(gallery_path):
        return web.json_response({"error": "Gallery directory not found"}, status=404)

    items = os.listdir(gallery_path)
    gallery_items = []

    for item_name in items:
        item_path = os.path.join(gallery_path, item_name)
        
        if os.path.isdir(item_path):
            mod_time = os.path.getmtime(item_path)
            gallery_items.append({
                "filename": item_name,
                "type": "directory",
                "subfolder": os.path.join(subfolder, item_name),
                "mod_time": mod_time
            })
        elif item_name.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm', '.mp3', '.wav', '.flac')):
            mod_time = os.path.getmtime(item_path)

            gallery_items.append({
                "filename": item_name,
                "type": "output",
                "subfolder": subfolder,
                "mod_time": mod_time
            })

    # Sort items: directories first, then by modification time
    gallery_items.sort(key=lambda x: (x['type'] == 'directory', x.get('mod_time', 0)), reverse=True)

    # Pagination
    total_items = len(gallery_items)
    total_pages = (total_items + per_page - 1) // per_page
    start_index = (page - 1) * per_page
    end_index = start_index + per_page
    paginated_items = gallery_items[start_index:end_index]

    # Remove mod_time before sending
    for item in paginated_items:
        if 'mod_time' in item:
            del item['mod_time']

    return web.json_response({
        "items": paginated_items,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
        "total_items": total_items
    })

async def upload_image(request: web.Request) -> web.Response:
    reader = await request.multipart()
    field = await reader.next()

    if field.name != 'image':
        return web.json_response({"error": "Expected field 'image'"}, status=400)

    filename = field.filename
    if not filename:
        return web.json_response({"error": "No filename provided"}, status=400)

    # Generate a unique filename to prevent collisions
    unique_filename = f"{uuid.uuid4()}_{filename}"
    
    # Save to the input directory of ComfyUI
    input_dir = folder_paths.get_input_directory()
    save_path = os.path.join(input_dir, unique_filename)

    size = 0
    with open(save_path, 'wb') as f:
        while True:
            chunk = await field.read_chunk()
            if not chunk:
                break
            f.write(chunk)
            size += len(chunk)

    return web.json_response({"filename": unique_filename, "size": size})

async def get_thumbnail(request: web.Request) -> web.Response:
    filename = request.rel_url.query.get('filename', '')
    subfolder = request.rel_url.query.get('subfolder', '')
    file_type = request.rel_url.query.get('type', 'output')
    width_param = request.rel_url.query.get('w', '256')
    quality_param = request.rel_url.query.get('q', '55')
    fmt = (request.rel_url.query.get('fmt', 'webp') or 'webp').lower()

    if not filename:
        return web.json_response({"error": "Missing 'filename' query parameter"}, status=400)
    if not filename.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.gif')):
        return web.json_response({"error": "Unsupported media type"}, status=415)

    try:
        width = int(width_param)
        quality = int(quality_param)
    except ValueError:
        return web.json_response({"error": "Invalid thumbnail parameters"}, status=400)

    width = max(32, min(1024, width))
    quality = max(20, min(90, quality))
    if fmt not in ("webp", "jpeg", "jpg", "png"):
        fmt = "jpeg"

    base_dir = get_base_dir_for_type(file_type)
    file_path = normalize_media_path(base_dir, subfolder, filename)
    if not file_path:
        return web.json_response({"error": "Unauthorized path"}, status=403)
    if not os.path.exists(file_path) or not os.path.isfile(file_path):
        return web.json_response({"error": "File not found"}, status=404)

    try:
        stat = os.stat(file_path)
        thumb_bytes, content_type = build_thumbnail_bytes(
            file_path,
            stat.st_mtime,
            stat.st_size,
            width,
            quality,
            fmt
        )
        return web.Response(
            body=thumb_bytes,
            content_type=content_type,
            headers={"Cache-Control": "public, max-age=3600"}
        )
    except Exception as e:
        return web.json_response({"error": f"Thumbnail generation failed: {e}"}, status=500)

async def get_history_list(request: web.Request) -> web.Response:
    items = list_history_entries()
    return web.json_response({"items": items})

async def get_history_item(request: web.Request) -> web.Response:
    history_id = request.match_info.get('history_id', '')
    if not history_id:
        return web.json_response({"error": "Missing history id"}, status=400)
    data = load_history_entry(history_id)
    if not data:
        return web.json_response({"error": "History item not found"}, status=404)
    return web.json_response(data)

async def save_history_item(request: web.Request) -> web.Response:
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON payload"}, status=400)

    history_id = payload.get("id")
    if not history_id:
        return web.json_response({"error": "Missing 'id' in payload"}, status=400)

    existing = load_history_entry(history_id) or {}
    merged = {**existing, **payload}
    write_history_entry(history_id, merged)
    return web.json_response({"status": "ok"})

async def update_history_item(request: web.Request) -> web.Response:
    history_id = request.match_info.get('history_id', '')
    if not history_id:
        return web.json_response({"error": "Missing history id"}, status=400)
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON payload"}, status=400)

    existing = load_history_entry(history_id)
    if not existing:
        return web.json_response({"error": "History item not found"}, status=404)
    merged = {**existing, **payload}
    write_history_entry(history_id, merged)
    return web.json_response({"status": "ok"})

async def get_session(request: web.Request) -> web.Response:
    data = load_session()
    if not data:
        return web.json_response({"error": "Session not found"}, status=404)
    return web.json_response(data)

async def save_session(request: web.Request) -> web.Response:
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON payload"}, status=400)
    if not isinstance(payload, dict):
        return web.json_response({"error": "Invalid session payload"}, status=400)
    existing = load_session() or {}
    merged = {**existing, **payload}
    write_session(merged)
    return web.json_response({"status": "ok"})

async def upload_workflow_file(request: web.Request) -> web.Response:
    filename = request.match_info.get('filename', 'workflow.json')
    workflows_dir = get_workflows_dir()
    os.makedirs(workflows_dir, exist_ok=True)
    workflow_path = os.path.join(workflows_dir, filename)
    
    workflow = await request.json()
    with open(workflow_path, 'w') as fp:
        json.dump(workflow, fp, indent=4)
        
    return web.json_response({ "filename": filename })
    
    

async def get_workflow_list(request: web.Request) -> web.Response:
    workflows_dir = get_workflows_dir()
    if not os.path.exists(workflows_dir):
        return web.json_response({"error": "Workflows directory not found"}, status=404)
    
    workflow_files = [f for f in os.listdir(workflows_dir) if f.endswith('.json')]
    return web.json_response({"workflows": workflow_files})

async def get_workflow_file(request: web.Request) -> web.Response:
    filename = request.match_info.get('filename', '')
    workflows_dir = get_workflows_dir()
    workflow_path = os.path.join(workflows_dir, filename)

    if not os.path.exists(workflow_path):
        return web.json_response({"error": f"Workflow file '{filename}' not found"}, status=404)
    
    try:
        with open(workflow_path, 'r', encoding='utf-8') as f:
            workflow_content = json.load(f)
        return web.json_response(workflow_content)
    except json.JSONDecodeError:
        return web.json_response({"error": f"Invalid JSON in workflow file '{filename}'"}, status=400)
    except Exception as e:
        return web.json_response({"error": f"Error reading workflow file: {e}"}, status=500)

import comfy.samplers

# Get all valid model folder types from ComfyUI itself
valid_model_types = folder_paths.folder_names_and_paths.keys()

# A map for aliases to official folder_paths names
alias_map = {
    "unet": "unet_gguf"
}


def _normalize_choice_value(value) -> str:
    if value is None:
        return ""
    return str(value).strip().replace("\\", "/")


def _normalize_choice_list(choices):
    normalized = []
    seen = set()
    for choice in choices:
        value = _normalize_choice_value(choice)
        if value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    return normalized

async def get_choices(request: web.Request) -> web.Response:
    choice_type = request.rel_url.query.get('type', '')

    if not choice_type:
        return web.json_response({"error": "Missing 'type' query parameter"}, status=400)

    # Alias map for backward compatibility
    alias_map = {
        "samplers_list": "sampler",
        "schedulers_list": "scheduler",
        "unet": "unet_gguf" # Example of another potential alias
    }
    resolved_choice_type = alias_map.get(choice_type, choice_type)

    choices = []
    if resolved_choice_type == "scheduler":
        choices = comfy.samplers.KSampler.SCHEDULERS
    elif resolved_choice_type == "sampler":
        choices = comfy.samplers.KSampler.SAMPLERS
    elif resolved_choice_type == "wanvideo_models":
        unet_models = folder_paths.get_filename_list("unet_gguf")
        diffusion_models = folder_paths.get_filename_list("diffusion_models")
        combined = [*unet_models, *diffusion_models]
        if combined:
            choices = combined
        else:
            choices = ["none"]
    elif resolved_choice_type in valid_model_types:
        choices = folder_paths.get_filename_list(resolved_choice_type)
    else:
        return web.json_response({"error": f"Invalid choice type: {choice_type}"}, status=400)

    choices = _normalize_choice_list(choices)
    return web.json_response({"choices": choices})

routes = [
    web.get('/cozygen/hello', get_hello),
    web.get('/cozygen/gallery', get_gallery_files),
    web.get('/cozygen/thumb', get_thumbnail),
    web.get('/cozygen/history', get_history_list),
    web.get('/cozygen/history/{history_id}', get_history_item),
    web.post('/cozygen/history', save_history_item),
    web.post('/cozygen/history/{history_id}', update_history_item),
    web.get('/cozygen/session', get_session),
    web.post('/cozygen/session', save_session),
    web.post('/cozygen/upload_image', upload_image),
    web.get('/cozygen/workflows', get_workflow_list),
    web.get('/cozygen/workflows/{filename}', get_workflow_file),
    web.post('/cozygen/workflows/{filename}', upload_workflow_file),
    web.get('/cozygen/get_choices', get_choices),
]
