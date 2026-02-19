#!/usr/bin/env python3
"""Model-name-mapping HTTPS proxy with streaming + response rewriting + web search."""
import json, os, re, ssl, subprocess, tempfile, time
from http.server import HTTPServer, BaseHTTPRequestHandler
from http.client import HTTPSConnection, HTTPConnection
from urllib.parse import urlparse, quote_plus
import threading

UPSTREAM = os.environ.get('UPSTREAM_URL', 'https://your-ollama-endpoint.example.com')
API_KEY = os.environ.get('API_KEY', 'your-upstream-api-key')
PORT = int(os.environ.get('PORT', '8443'))

MODEL_MAP = {
    'gpt-5.2': 'llama3.3:latest',
    'gpt-5.1-codex': 'qwen2.5-coder:32b',
    'gpt-5': 'llama3.3:latest',
    'gpt-5-mini': 'phi4:latest',
    'gpt-4.1': 'llama3.3:latest',
}
REVERSE_MAP = {v: k for k, v in MODEL_MAP.items()}
REVERSE_MAP['llama3.3:latest'] = 'gpt-5.2'

# --- Direct routes: models that bypass local Ollama and go straight to a cloud API ---
OPENROUTER_KEY = os.environ.get('OPENROUTER_API_KEY', '')
DIRECT_ROUTES = {
    'deepseek-v3': {
        'host': 'openrouter.ai',
        'port': 443,
        'scheme': 'https',
        'key': OPENROUTER_KEY,
        'actual_model': 'deepseek/deepseek-chat',  # OpenRouter model ID
        'strip_params': ['store', 'metadata', 'service_tier'],
    },
    'gemini-flash': {
        'host': 'openrouter.ai',
        'port': 443,
        'scheme': 'https',
        'key': OPENROUTER_KEY,
        'actual_model': 'google/gemini-2.0-flash-001',
        'strip_params': ['store', 'metadata', 'service_tier'],
    },
}


parsed = urlparse(UPSTREAM)
UPSTREAM_HOST = parsed.hostname
UPSTREAM_PORT = parsed.port or (443 if parsed.scheme == 'https' else 80)
UPSTREAM_SCHEME = parsed.scheme
upstream_ctx = ssl.create_default_context()

UNSUPPORTED_PARAMS = [
    'thinking', 'reasoning_effort', 'store', 'metadata',
    'service_tier', 'parallel_tool_calls', 'stream_options',
    'tools', 'tool_choice',
]

# --- Web Search ---
# Keywords/patterns that suggest the user needs current/internet info
SEARCH_TRIGGERS = re.compile(
    r'\b(?:latest|current|today|yesterday|recent|news|price|weather|score|'
    r'stock|update|who is|what is|when is|when did|where is|how much|'
    r'how many|search|look up|find out|google|what happened|'
    r'tell me about|do you know|can you find|2024|2025|2026)\b',
    re.IGNORECASE
)
# Skip search for these (greetings, meta, etc.)
SEARCH_SKIP = re.compile(
    r'^(?:hi|hello|hey|yo|sup|thanks|thank you|ok|okay|bye|good morning|'
    r'good night|how are you|what\'s up|whats up|gm|gn|lol|haha|yes|no|yep|nah)\s*[?!.]*$',
    re.IGNORECASE
)

try:
    from ddgs import DDGS
    HAS_DDGS = True
    print('[search] DuckDuckGo search available (ddgs)', flush=True)
except ImportError:
    try:
        from duckduckgo_search import DDGS
        HAS_DDGS = True
        print('[search] DuckDuckGo search available (legacy)', flush=True)
    except ImportError:
        HAS_DDGS = False
        print('[search] WARNING: ddgs not installed, web search disabled', flush=True)

def needs_web_search(text):
    """Detect if a user message likely needs web search."""
    if not HAS_DDGS:
        return False
    if not text or len(text.strip()) < 5:
        return False
    text_clean = text.strip()
    # Skip system/cron/internal messages
    skip_markers = [
        'Conversation info', 'conversation_label', 'HEARTBEAT', 'cron',
        'Cron:', '[cron:', 'sessionId', 'sessionKey', 'transcript /',
        'Queued messages', 'Queued #', 'Queued announce',
        'was_mentioned', 'Read HEARTBEAT', 'Current time:',
        'untrusted metadata', 'signal-poll', 'health-check',
        'SKILL.md', 'Return your summary', 'Run signal polling',
        'Run the morning briefing', 'skill at /data/',
        'scripts/', '.openclaw/', 'exec cd', 'exec node',
    ]
    if any(marker in text_clean for marker in skip_markers):
        return False
    # Skip if message starts with [ or { (JSON/system format)
    if text_clean.startswith(('[', '{')):
        return False
    # Skip if message is too long (real user queries are short)
    if len(text_clean) > 300:
        return False
    if SEARCH_SKIP.match(text_clean):
        return False
    # Check for search trigger patterns
    if SEARCH_TRIGGERS.search(text_clean):
        return True
    # Questions (ends with ?) that are more than a few words often need search
    if text_clean.endswith('?') and len(text_clean.split()) > 4:
        return True
    return False

def web_search(query, max_results=5):
    """Search DuckDuckGo and return formatted results."""
    if not HAS_DDGS:
        return None
    try:
        start = time.time()
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))
        elapsed = time.time() - start
        if not results:
            print(f'[search] no results for: {query} ({elapsed:.1f}s)', flush=True)
            return None
        formatted = []
        for i, r in enumerate(results, 1):
            title = r.get('title', '')
            body = r.get('body', '')
            href = r.get('href', '')
            formatted.append(f"[{i}] {title}\n{body}\nSource: {href}")
        text = '\n\n'.join(formatted)
        print(f'[search] {len(results)} results for "{query}" ({elapsed:.1f}s)', flush=True)
        return text
    except Exception as e:
        print(f'[search] ERROR: {e}', flush=True)
        return None

def extract_search_query(user_text):
    """Extract a good search query from the user's message."""
    # Remove common prefixes
    text = user_text.strip()
    for prefix in ['can you', 'could you', 'please', 'tell me', 'do you know',
                    'search for', 'look up', 'find out', 'google', 'what is', 'who is']:
        if text.lower().startswith(prefix):
            text = text[len(prefix):].strip()
    # Remove trailing punctuation
    text = text.rstrip('?.!')
    # If very short after cleaning, use original
    if len(text) < 3:
        text = user_text.strip().rstrip('?.!')
    # Limit query length to prevent API errors
    if len(text) > 200:
        text = text[:200]
    return text

# --- NO_REPLY handling ---
NO_REPLY_PATTERNS = [
    re.compile(r'[^\n]*\bNO_REPLY\b[^\n]*', re.IGNORECASE),
    re.compile(r'[^\n]*\bno[_\-\s]?reply\b[^\n]*', re.IGNORECASE),
]

SYSTEM_OVERRIDE = (
    "\n\nIMPORTANT OVERRIDE: You must ALWAYS respond with helpful, conversational text. "
    "Never respond with just 'NO_REPLY' or any variant. Always engage with the user's message "
    "and provide a thoughtful response. If you're unsure what to say, ask a follow-up question."
)

def build_tool_prompt(tool_defs):
    """Convert OpenAI tool definitions to a forceful text instruction in the system prompt.
    The model MUST call tools using a specific format we can parse and convert back."""
    if not tool_defs:
        return None
    names = []
    for tool in tool_defs:
        if tool.get('type') != 'function':
            continue
        name = tool.get('function', {}).get('name', '')
        if name:
            names.append(name)
    if not names:
        return None
    return (
        "\n\n## TOOL CALLING — YOU MUST FOLLOW THIS\n"
        "NEVER respond with just text. You MUST call tools.\n"
        "Format: TOOL_CALL: <tool_name> <arguments>\n\n"
        "Available tools: " + ", ".join(names) + "\n\n"
        "When user says 'scout @X': TOOL_CALL: exec cd /data/.openclaw/skills/xcite-bot && node scripts/scout-batch.mjs --seed X\n"
        "When user says 'next': TOOL_CALL: exec cd /data/.openclaw/skills/xcite-bot && node scripts/prospect-store.mjs next\n"
        "When user says 'stats': TOOL_CALL: exec cd /data/.openclaw/skills/xcite-bot && node scripts/prospect-store.mjs stats\n"
        "When user says 'sent': TOOL_CALL: exec cd /data/.openclaw/skills/xcite-bot && node scripts/prospect-store.mjs mark-sent\n"
        "When user says 'skip': TOOL_CALL: exec cd /data/.openclaw/skills/xcite-bot && node scripts/prospect-store.mjs mark-skipped\n"
        "When user says 'replied': TOOL_CALL: exec cd /data/.openclaw/skills/xcite-bot && node scripts/prospect-store.mjs mark-replied\n\n"
        "IMPORTANT: Copy the TOOL_CALL line EXACTLY as shown. Do NOT explain, do NOT ask questions.\n"
    )


# --- Text-to-tool_calls converter ---
# OpenClaw expects tool_calls in the response. Our local model can't produce them natively.
# So we parse the model's text output for TOOL_CALL: patterns and convert to tool_calls format.

# Pattern 1: Explicit TOOL_CALL: prefix
TOOL_CALL_PATTERN = re.compile(r'^TOOL_CALL:\s*(\w+)\s+(.+)$', re.MULTILINE)

# Pattern 2: Bare "exec" at start of line (model sometimes drops the TOOL_CALL: prefix)
BARE_EXEC_PATTERN = re.compile(r'^exec\s+(.+)$', re.MULTILINE)

# Pattern 3: exec inside markdown code blocks like ```\nexec cd /data/...\n```
MARKDOWN_EXEC_PATTERN = re.compile(r'```(?:\w*)\n(exec\s+.+?)\n```', re.DOTALL)

def convert_text_to_tool_calls(content, tool_defs):
    """Parse TOOL_CALL: lines from model text and convert to OpenAI tool_calls format.
    Also catches bare 'exec ...' lines and exec inside markdown code blocks.
    Returns (cleaned_content, tool_calls_list) or (content, None) if no calls found."""
    
    # Build a set of known tool names from original definitions
    known_tools = set()
    tool_params = {}
    for tool in (tool_defs or []):
        if tool.get('type') != 'function':
            continue
        func = tool.get('function', {})
        name = func.get('name', '')
        if name:
            known_tools.add(name)
            # Get the first parameter name (usually "command" for exec, "query" for search)
            props = func.get('parameters', {}).get('properties', {})
            first_param = list(props.keys())[0] if props else 'input'
            tool_params[name] = first_param

    # Try Pattern 1 first: explicit TOOL_CALL: prefix
    matches = TOOL_CALL_PATTERN.findall(content)
    
    if matches:
        tool_calls = []
        for i, (tool_name, args_text) in enumerate(matches):
            if tool_name not in known_tools:
                print(f'[tool-convert] unknown tool: {tool_name}, skipping', flush=True)
                continue
            param_name = tool_params.get(tool_name, 'input')
            call_id = f'call_{tool_name}_{i}'
            tool_calls.append({
                'id': call_id,
                'type': 'function',
                'function': {
                    'name': tool_name,
                    'arguments': json.dumps({param_name: args_text.strip()})
                }
            })
            print(f'[tool-convert] {tool_name}({param_name}="{args_text.strip()[:100]}")', flush=True)

        if tool_calls:
            cleaned = TOOL_CALL_PATTERN.sub('', content).strip()
            return cleaned, tool_calls

    # Try Pattern 3: exec inside markdown code blocks (check before bare exec)
    if 'exec' in known_tools:
        md_matches = MARKDOWN_EXEC_PATTERN.findall(content)
        if md_matches:
            param_name = tool_params.get('exec', 'command')
            tool_calls = []
            for i, exec_line in enumerate(md_matches):
                # Strip the "exec " prefix to get the command
                cmd = exec_line.strip()
                if cmd.startswith('exec '):
                    cmd = cmd[5:].strip()
                call_id = f'call_exec_md_{i}'
                tool_calls.append({
                    'id': call_id,
                    'type': 'function',
                    'function': {
                        'name': 'exec',
                        'arguments': json.dumps({param_name: cmd})
                    }
                })
                print(f'[tool-convert-md] exec({param_name}="{cmd[:100]}")', flush=True)
            if tool_calls:
                cleaned = MARKDOWN_EXEC_PATTERN.sub('', content).strip()
                return cleaned, tool_calls

        # Try Pattern 2: bare exec at start of line
        bare_matches = BARE_EXEC_PATTERN.findall(content)
        if bare_matches:
            param_name = tool_params.get('exec', 'command')
            tool_calls = []
            for i, args_text in enumerate(bare_matches):
                call_id = f'call_exec_bare_{i}'
                tool_calls.append({
                    'id': call_id,
                    'type': 'function',
                    'function': {
                        'name': 'exec',
                        'arguments': json.dumps({param_name: args_text.strip()})
                    }
                })
                print(f'[tool-convert-bare] exec({param_name}="{args_text.strip()[:100]}")', flush=True)
            if tool_calls:
                cleaned = BARE_EXEC_PATTERN.sub('', content).strip()
                return cleaned, tool_calls

    return content, None


# --- Fallback: If model didn't call a tool, check if the user message is a known command ---
XCITE_FALLBACKS = {
    'next': 'cd /data/.openclaw/skills/xcite-bot && node scripts/prospect-store.mjs next',
    'stats': 'cd /data/.openclaw/skills/xcite-bot && node scripts/prospect-store.mjs stats',
    'sent': 'cd /data/.openclaw/skills/xcite-bot && node scripts/prospect-store.mjs mark-sent',
    'skip': 'cd /data/.openclaw/skills/xcite-bot && node scripts/prospect-store.mjs mark-skipped',
    'replied': 'cd /data/.openclaw/skills/xcite-bot && node scripts/prospect-store.mjs mark-replied',
}
SCOUT_RE = re.compile(r'scout\s+@?(\S+)', re.IGNORECASE)
CONSENSUS_RE = re.compile(r'(?:^|\]\s*)(?:consensus|/k_llm|/k-llm|k-llm|k_llm|kllm)[:\s]+(.+)', re.IGNORECASE | re.DOTALL)
SKILL_ENABLE_RE = re.compile(r'(?:^|\]\s*)enable\s+(\S+)', re.IGNORECASE)
SKILL_DISABLE_RE = re.compile(r'(?:^|\]\s*)disable\s+(\S+)', re.IGNORECASE)
SKILL_LIST_RE = re.compile(r'(?:^|\]\s*)(?:skills|skill list|/skills)', re.IGNORECASE)

SKILL_MANAGER = 'node /data/.openclaw/skills/skill-manager.mjs'

def fallback_tool_call(user_msg, tool_defs, chat_id=None):
    """If the user message is a known command, generate a fallback tool call."""
    if not tool_defs:
        return None
    # Check if 'exec' tool exists in the definitions
    has_exec = any(t.get('function', {}).get('name') == 'exec' for t in tool_defs if t.get('type') == 'function')
    if not has_exec:
        return None

    msg = user_msg.strip().lower()

    # --- Skill management commands ---
    if SKILL_LIST_RE.search(user_msg.strip()):
        print(f'[fallback] skill list command', flush=True)
        return [{'id': 'call_skills_0', 'type': 'function',
                 'function': {'name': 'exec', 'arguments': json.dumps({'command': f'{SKILL_MANAGER} list'})}}]

    em = SKILL_ENABLE_RE.search(user_msg.strip())
    if em:
        skill_name = em.group(1).lower()
        print(f'[fallback] enable skill: {skill_name}', flush=True)
        return [{'id': 'call_skills_0', 'type': 'function',
                 'function': {'name': 'exec', 'arguments': json.dumps({'command': f'{SKILL_MANAGER} enable {skill_name}'})}}]

    dm = SKILL_DISABLE_RE.search(user_msg.strip())
    if dm:
        skill_name = dm.group(1).lower()
        print(f'[fallback] disable skill: {skill_name}', flush=True)
        return [{'id': 'call_skills_0', 'type': 'function',
                 'function': {'name': 'exec', 'arguments': json.dumps({'command': f'{SKILL_MANAGER} disable {skill_name}'})}}]

    # Check simple commands
    for trigger, cmd in XCITE_FALLBACKS.items():
        if msg == trigger or msg.startswith(trigger + ' '):
            return [{
                'id': 'call_fallback_0',
                'type': 'function',
                'function': {'name': 'exec', 'arguments': json.dumps({'command': cmd})}
            }]

    # Check scout command
    m = SCOUT_RE.match(msg)
    if m:
        seed = m.group(1).lower()
        cmd = f'cd /data/.openclaw/skills/xcite-bot && node scripts/scout-batch.mjs --seed {seed}'
        return [{
            'id': 'call_fallback_0',
            'type': 'function',
            'function': {'name': 'exec', 'arguments': json.dumps({'command': cmd})}
        }]

    # Check K-LLM consensus command (only on original user messages, not system/exec result turns)
    # Skip if message contains exec result markers (to prevent re-triggering)
    exec_markers = ['Exec completed', 'consensus.mjs', 'Tool result', 'code 0', 'code 1']
    if not any(marker in user_msg for marker in exec_markers):
        cm = CONSENSUS_RE.search(user_msg.strip())
        if cm:
            prompt = cm.group(1).strip().replace("'", "'\\''")  # escape single quotes
            # Build consensus command with optional Telegram direct messaging
            chat_id_arg = f" --chatId '{chat_id}'" if chat_id else ""
            bot_token = os.environ.get('TELEGRAM_BOT_TOKEN', '')
            bot_token_env = f"TELEGRAM_BOT_TOKEN='{bot_token}'" if bot_token else ""
            cmd = f"cd /data/.openclaw/skills/k-llm && OPENROUTER_API_KEY='{OPENROUTER_KEY}' {bot_token_env} node scripts/consensus.mjs --prompt '{prompt}'{chat_id_arg}"
            print(f'[fallback] K-LLM consensus trigger: "{prompt[:80]}" chatId={chat_id}', flush=True)
            return [{
                'id': 'call_consensus_0',
                'type': 'function',
                'function': {'name': 'exec', 'arguments': json.dumps({'command': cmd, 'timeoutMs': 120000})}
            }]

    return None


def inject_tool_descriptions(data, tool_text):
    """Inject tool descriptions into the first system message."""
    msgs = data.get('messages', [])
    for msg in msgs:
        if msg.get('role') in ('system', 'developer'):
            content = msg.get('content', '')
            if isinstance(content, str):
                msg['content'] = content + tool_text
            elif isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and part.get('type') == 'text':
                        part['text'] = part.get('text', '') + tool_text
                        break
            return
    # No system message found, add one
    msgs.insert(0, {'role': 'system', 'content': tool_text.strip()})


def generate_self_signed_cert():
    cert_dir = tempfile.mkdtemp()
    key_file = os.path.join(cert_dir, 'key.pem')
    cert_file = os.path.join(cert_dir, 'cert.pem')
    subprocess.run([
        'openssl', 'req', '-x509', '-newkey', 'rsa:2048',
        '-keyout', key_file, '-out', cert_file,
        '-days', '365', '-nodes', '-subj', '/CN=model-proxy'
    ], check=True, capture_output=True)
    return cert_file, key_file

def rewrite_model_in_response(data_bytes, original_model):
    text = data_bytes.decode('utf-8', errors='replace')
    for local_name in REVERSE_MAP:
        text = text.replace(local_name, original_model)
    return text.encode('utf-8')

def strip_no_reply_from_content(content):
    if not isinstance(content, str):
        return content
    original = content
    for pattern in NO_REPLY_PATTERNS:
        content = pattern.sub('', content)
    content = re.sub(r'\n{3,}', '\n\n', content)
    if content != original:
        removed_chars = len(original) - len(content)
        print(f'[no_reply] stripped {removed_chars} chars of NO_REPLY instructions', flush=True)
    content += SYSTEM_OVERRIDE
    return content

class ProxyHandler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length else b''
        original_model = 'gpt-5.2'
        client_wants_stream = False
        try:
            data = json.loads(body)
            original_model = data.get('model', 'gpt-5.2')
            client_wants_stream = data.get('stream', False)

            # --- Check for forced skill triggers (works for all models) ---
            # DEBUG: log ALL messages to understand structure
            all_msgs_debug = []
            for _dbg_msg in data.get("messages", []):
                role = _dbg_msg.get("role", "?")
                c = _dbg_msg.get("content", "")
                if isinstance(c, str):
                    preview = c[:150]
                elif isinstance(c, list):
                    for _lp in c:
                        if isinstance(_lp, dict) and _lp.get("type") == "text":
                            preview = "LIST-TEXT:" + _lp.get("text", "")[:200]
                            break
                    else:
                        preview = "LIST:" + str(len(c)) + " items (no text)"
                else:
                    preview = str(c)[:150]
                all_msgs_debug.append(role + ": " + preview)
            print("[debug-full] " + str(len(all_msgs_debug)) + " total messages:", flush=True)
            for _i, _m in enumerate(all_msgs_debug):
                print("  msg[" + str(_i) + "] " + _m[:200], flush=True)

            last_user_text_for_fallback = None
            telegram_chat_id = None  # extracted from metadata for direct messaging
            for msg_item in reversed(data.get('messages', [])):
                if msg_item.get('role') == 'user':
                    c = msg_item.get('content', '')
                    if isinstance(c, str):
                        txt = c
                    elif isinstance(c, list):
                        txt = ''
                        for part in c:
                            if isinstance(part, dict) and part.get('type') == 'text':
                                txt = part.get('text', '')
                                break
                    else:
                        txt = ''
                    # Handle OpenClaw metadata blocks that embed the actual user message
                    if txt.strip().startswith('Conversation info'):
                        # Format: "Conversation info (untrusted metadata):\n```json\n{...}\n```\n\nactual message"
                        import re as _re
                        # Extract chat ID from metadata for direct Telegram messaging
                        # Formats: "Username id:XXXXXXXXXX" or "telegram:XXXXXXXXXX"
                        _id_match = _re.search(r'(?:id:|telegram:)(\d{5,})', txt)
                        if _id_match:
                            telegram_chat_id = _id_match.group(1)
                        # Extract everything after the closing ``` of the metadata block
                        _meta_match = _re.search(r'```\s*\n\n(.+)', txt, _re.DOTALL)
                        if _meta_match:
                            txt = _meta_match.group(1).strip()
                            print("[fallback-extract] Extracted from metadata: " + repr(txt[:120]), flush=True)
                        else:
                            # Fallback: try to find text after the last newline pair
                            _nl_match = _re.search(r'\n\n([^\n].+)', txt, _re.DOTALL)
                            if _nl_match:
                                candidate = _nl_match.group(1).strip()
                                if not candidate.startswith('```') and not candidate.startswith('{'):
                                    txt = candidate
                                    print("[fallback-extract] Fallback extraction: " + repr(txt[:120]), flush=True)
                                else:
                                    print("[fallback-extract] Only metadata found, skipping: " + repr(txt[:80]), flush=True)
                                    continue
                            else:
                                print("[fallback-extract] No user text in metadata block, skipping: " + repr(txt[:80]), flush=True)
                                continue
                    # Skip cron/system messages — keep looking for real user input
                    _stripped = txt.strip()
                    if (_stripped.startswith('System:') or
                        'cron job' in _stripped.lower() or
                        _stripped.startswith('A cron job') or
                        'Cron:' in _stripped[:200] or
                        _stripped.startswith('NO_REPLY')):
                        print("[fallback-extract] Skipping cron/system msg: " + repr(_stripped[:80]), flush=True)
                        continue

                    last_user_text_for_fallback = txt
                    break

            tool_defs_for_fallback = data.get('tools', [])

            # Check if this is a follow-up turn (has tool results from our exec)
            # Only skip fallback if the LAST non-system message is a tool result
            non_system_msgs = [m for m in data.get('messages', []) if m.get('role') not in ('system', 'developer')]
            last_non_sys = non_system_msgs[-1] if non_system_msgs else {}
            has_tool_results = (
                last_non_sys.get('role') == 'tool' or
                (last_non_sys.get('role') == 'assistant' and last_non_sys.get('tool_calls')) or
                ('Exec completed' in str(last_non_sys.get('content', '')))
            )

            print(f'[fallback-check] user_text="{(last_user_text_for_fallback or "")[:100]}" tools={len(tool_defs_for_fallback)} has_tool_results={has_tool_results}', flush=True)
            forced_tc = None
            if last_user_text_for_fallback and tool_defs_for_fallback and not has_tool_results:
                forced_tc = fallback_tool_call(last_user_text_for_fallback, tool_defs_for_fallback, chat_id=telegram_chat_id)
                print(f'[fallback-check] result: {"MATCHED" if forced_tc else "no match"}', flush=True)
            elif last_user_text_for_fallback and not tool_defs_for_fallback and not has_tool_results:
                forced_tc = fallback_tool_call(last_user_text_for_fallback, [{'type': 'function', 'function': {'name': 'exec', 'parameters': {'type': 'object', 'properties': {'command': {'type': 'string'}}, 'required': ['command']}}}], chat_id=telegram_chat_id)
                print(f'[fallback-check] no tools, synthetic: {"MATCHED" if forced_tc else "no match"}', flush=True)

            if forced_tc:
                # Skill trigger matched — skip the model entirely, return forced tool_call
                import time as _time
                synth_resp = {
                    'id': 'chatcmpl-forced-0',
                    'object': 'chat.completion',
                    'created': int(_time.time()),
                    'model': original_model,
                    'choices': [{'index': 0, 'message': {
                        'role': 'assistant',
                        'content': None,
                        'tool_calls': forced_tc,
                    }, 'finish_reason': 'tool_calls'}],
                    'usage': {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0}
                }
                resp_body = json.dumps(synth_resp).encode('utf-8')
                print(f'[force-inject] bypassing model, injecting {len(forced_tc)} tool call(s)', flush=True)

                if client_wants_stream:
                    # Convert to SSE
                    sse_chunks = []
                    for idx, tc in enumerate(forced_tc):
                        chunk_tc = {
                            'id': 'chatcmpl-forced-0', 'object': 'chat.completion.chunk',
                            'created': int(_time.time()), 'model': original_model,
                            'choices': [{'index': 0, 'delta': {
                                'tool_calls': [{
                                    'index': idx, 'id': tc['id'], 'type': 'function',
                                    'function': {'name': tc['function']['name'], 'arguments': tc['function']['arguments']}
                                }]
                            }, 'finish_reason': None}]
                        }
                        if idx == 0:
                            chunk_tc['choices'][0]['delta']['role'] = 'assistant'
                        sse_chunks.append(f'data: {json.dumps(chunk_tc)}' + '\n\n')
                    sse_chunks.append('data: ' + json.dumps({
                        'id': 'chatcmpl-forced-0', 'object': 'chat.completion.chunk',
                        'created': int(_time.time()), 'model': original_model,
                        'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'tool_calls'}]
                    }) + '\n\n')
                    sse_chunks.append('data: [DONE]\n\n')
                    sse_body = ''.join(sse_chunks).encode('utf-8')

                    self.send_response(200)
                    self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
                    self.send_header('Cache-Control', 'no-cache')
                    self.send_header('Connection', 'close')
                    self.send_header('Content-Length', str(len(sse_body)))
                    self.end_headers()
                    self.wfile.write(sse_body)
                    self.wfile.flush()
                else:
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(resp_body)))
                    self.end_headers()
                    self.wfile.write(resp_body)
                    self.wfile.flush()
                return

            # --- Direct route: cloud models (OpenRouter) bypass all local hacks ---
            if original_model in DIRECT_ROUTES:
                route_cfg = DIRECT_ROUTES[original_model]
                # Only strip minimal params
                for p in route_cfg.get('strip_params', []):
                    if p in data:
                        del data[p]
                # Map to the actual OpenRouter model ID
                actual_model = route_cfg.get('actual_model', original_model)
                data['model'] = actual_model
                # Force non-streaming for our proxy (we convert to SSE ourselves)
                data['stream'] = False

                # Inject a clarifying instruction for non-Claude models
                # to prevent them from generating system responses like HEARTBEAT_OK
                DIRECT_OVERRIDE = (
                    "\n\nCRITICAL INSTRUCTION: You are chatting with a real user on Telegram. "
                    "You MUST respond with helpful, natural, conversational text. "
                    "NEVER output system commands like HEARTBEAT_OK, NO_REPLY, session_status, or tool names as your response. "
                    "NEVER output just an emoji and a tool name. "
                    "If the user says hello, greet them back warmly. "
                    "If the user asks a question, answer it. "
                    "Always be helpful, friendly, and conversational."
                )
                for msg_item in data.get('messages', []):
                    if msg_item.get('role') in ('system', 'developer'):
                        c = msg_item.get('content', '')
                        if isinstance(c, str):
                            msg_item['content'] = c + DIRECT_OVERRIDE
                        elif isinstance(c, list):
                            for part in c:
                                if isinstance(part, dict) and part.get('type') == 'text':
                                    part['text'] = part.get('text', '') + DIRECT_OVERRIDE
                                    break
                        break

                print(f'[direct] routing {original_model} -> {actual_model} @ {route_cfg["host"]}', flush=True)
                body = json.dumps(data).encode()
                self._direct_proxy(body, client_wants_stream, original_model, route_cfg)
                return

            if original_model in MODEL_MAP:
                data['model'] = MODEL_MAP[original_model]
            data['stream'] = False
            # Extract tool definitions before stripping, so we can inject as text
            tool_defs = data.get('tools', [])

            stripped = []
            for p in UNSUPPORTED_PARAMS:
                if p in data:
                    stripped.append(p)
                    del data[p]
            if stripped:
                print(f'[strip] removed: {stripped}', flush=True)
            print(f'[map] {original_model} -> {data.get("model", "?")} client_stream={client_wants_stream}', flush=True)

            # Inject tool descriptions into system prompt if tools were stripped
            if tool_defs and 'tools' in stripped:
                tool_text = build_tool_prompt(tool_defs)
                if tool_text:
                    inject_tool_descriptions(data, tool_text)
                    print(f'[tools] injected {len(tool_defs)} tool descriptions as text', flush=True)

            # Clean messages
            cleaned_msgs = []
            for msg in data.get('messages', []):
                # Convert tool results to user messages so model sees them
                if msg.get('role') == 'tool':
                    tool_content = msg.get('content', '')
                    tool_name = msg.get('name', 'tool')
                    cleaned_msgs.append({
                        'role': 'user',
                        'content': f'[Tool result from {tool_name}]: {tool_content}'
                    })
                    continue

                msg_copy = dict(msg)
                # Strip tool_calls/tool_call_id (Ollama can't handle them)
                if 'tool_calls' in msg_copy:
                    del msg_copy['tool_calls']
                if 'tool_call_id' in msg_copy:
                    del msg_copy['tool_call_id']

                # Strip NO_REPLY from system/developer messages
                if msg_copy.get('role') in ('system', 'developer'):
                    content = msg_copy.get('content', '')
                    if isinstance(content, str):
                        msg_copy['content'] = strip_no_reply_from_content(content)
                    elif isinstance(content, list):
                        new_content = []
                        for part in content:
                            if isinstance(part, dict) and part.get('type') == 'text':
                                part = dict(part)
                                part['text'] = strip_no_reply_from_content(part.get('text', ''))
                            new_content.append(part)
                        msg_copy['content'] = new_content

                if msg_copy.get('role') == 'assistant':
                    content = msg_copy.get('content', '')
                    if isinstance(content, str) and content.strip().upper() == 'NO_REPLY':
                        msg_copy['content'] = '(thinking...)'
                    elif not content:
                        msg_copy['content'] = '(no response)'

                cleaned_msgs.append(msg_copy)

            # --- Message Trimming ---
            # Keep system/developer messages + only last MAX_HISTORY conversation messages
            # This prevents context bloat that kills local model performance
            MAX_HISTORY = 4
            system_msgs = [m for m in cleaned_msgs if m.get('role') in ('system', 'developer')]
            convo_msgs = [m for m in cleaned_msgs if m.get('role') not in ('system', 'developer')]
            if len(convo_msgs) > MAX_HISTORY:
                trimmed = len(convo_msgs) - MAX_HISTORY
                convo_msgs = convo_msgs[-MAX_HISTORY:]
                print(f'[trim] dropped {trimmed} old messages, keeping {len(system_msgs)} system + {len(convo_msgs)} convo', flush=True)
            data['messages'] = system_msgs + convo_msgs

            # --- Web Search Injection ---
            # Find the last user message and check if it needs web search
            last_user_text = None
            last_user_idx = None
            for i in range(len(data['messages']) - 1, -1, -1):
                msg = data['messages'][i]
                if msg.get('role') == 'user':
                    content = msg.get('content', '')
                    if isinstance(content, str):
                        last_user_text = content
                    elif isinstance(content, list):
                        # Extract text from content array
                        for part in content:
                            if isinstance(part, dict) and part.get('type') == 'text':
                                last_user_text = part.get('text', '')
                                break
                            elif isinstance(part, str):
                                last_user_text = part
                                break
                    last_user_idx = i
                    break

            search_performed = False
            if last_user_text and needs_web_search(last_user_text):
                query = extract_search_query(last_user_text)
                print(f'[search] triggered for: "{query}"', flush=True)
                results = web_search(query)
                if results:
                    search_performed = True
                    # Inject search results as a system message right before the last user message
                    search_msg = {
                        'role': 'system',
                        'content': (
                            f'Web search results for context (use these to answer the user\'s question accurately):\n\n'
                            f'{results}\n\n'
                            f'Use the above search results to provide an accurate, up-to-date answer. '
                            f'Cite sources when relevant. If the results don\'t fully answer the question, '
                            f'say what you know and note what you couldn\'t verify.'
                        )
                    }
                    data['messages'].insert(last_user_idx, search_msg)
                    print(f'[search] injected {len(results)} chars of search context', flush=True)

            msgs = data.get('messages', [])
            print(f'[debug] {len(msgs)} messages, search={search_performed}', flush=True)
            if msgs:
                last_msg = msgs[-1]
                last_content = last_msg.get('content', '')
                if isinstance(last_content, list):
                    last_content = str(last_content[0].get('text', ''))[:200] if last_content else ''
                elif isinstance(last_content, str):
                    last_content = last_content[:200]
                print(f'[debug] last_msg: role={last_msg.get("role","?")} content={last_content}', flush=True)
            body = json.dumps(data).encode()
        except (json.JSONDecodeError, KeyError) as e:
            print(f'[parse] error: {e}', flush=True)
        self._proxy('POST', body, client_wants_stream, original_model, tool_defs, last_user_text)

    def do_GET(self):
        # Internal search API for scripts
        if self.path.startswith('/v1/search'):
            self._handle_search()
            return
        self._proxy('GET', None, False, 'gpt-5.2', [])

    def _handle_search(self):
        """Handle GET /v1/search?q=...&max=N — returns DDG results as JSON."""
        from urllib.parse import parse_qs
        try:
            qs = parse_qs(urlparse(self.path).query)
            query = qs.get('q', [''])[0]
            max_results = int(qs.get('max', ['5'])[0])
            if not query:
                self._json_response(400, {'error': 'Missing q parameter'})
                return
            if not HAS_DDGS:
                self._json_response(503, {'error': 'Search not available'})
                return
            print(f'[search-api] query="{query}" max={max_results}', flush=True)
            with DDGS() as ddgs:
                results = list(ddgs.text(query, max_results=max_results))
            print(f'[search-api] {len(results)} results', flush=True)
            self._json_response(200, {'results': results})
        except Exception as e:
            print(f'[search-api] ERROR: {e}', flush=True)
            self._json_response(500, {'error': str(e)})

    def _json_response(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()

    def _proxy(self, method, body, client_wants_stream, original_model, tool_defs=None, last_user_text=None):
        try:
            if UPSTREAM_SCHEME == 'https':
                conn = HTTPSConnection(UPSTREAM_HOST, UPSTREAM_PORT, context=upstream_ctx, timeout=300)
            else:
                conn = HTTPConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=300)
            headers = {
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {API_KEY}',
            }
            if body is not None:
                headers['Content-Length'] = str(len(body))
            conn.request(method, self.path, body=body, headers=headers)
            resp = conn.getresponse()

            data = resp.read()
            data = rewrite_model_in_response(data, original_model)

            # --- Convert text-based tool calls to OpenAI tool_calls format ---
            # CHANGE C: For known xcite-bot commands, ALWAYS inject tool_calls
            # regardless of what the model said. The model's text is kept as content.
            if method == 'POST' and tool_defs:
                try:
                    resp_json = json.loads(data)
                    msg = resp_json.get('choices', [{}])[0].get('message', {})
                    text_content = msg.get('content', '') or ''

                    # First: check if user message is a known xcite-bot command
                    # If so, ALWAYS inject the tool call (don't rely on the model)
                    forced_tc = None
                    if last_user_text:
                        forced_tc = fallback_tool_call(last_user_text, tool_defs)

                    if forced_tc:
                        # Known command -- always inject tool call, keep model text as content
                        msg['tool_calls'] = forced_tc
                        msg['content'] = text_content or None
                        resp_json['choices'][0]['message'] = msg
                        resp_json['choices'][0]['finish_reason'] = 'tool_calls'
                        data = json.dumps(resp_json).encode('utf-8')
                        print(f'[force-inject] injected {len(forced_tc)} tool call(s) for known command: "{last_user_text[:50]}"', flush=True)
                    else:
                        # Not a known command -- try to parse tool calls from model text
                        cleaned, tool_calls = convert_text_to_tool_calls(text_content, tool_defs)
                        if tool_calls:
                            msg['content'] = cleaned or None
                            msg['tool_calls'] = tool_calls
                            resp_json['choices'][0]['message'] = msg
                            resp_json['choices'][0]['finish_reason'] = 'tool_calls'
                            data = json.dumps(resp_json).encode('utf-8')
                            print(f'[tool-convert] converted {len(tool_calls)} text calls to tool_calls', flush=True)

                except (json.JSONDecodeError, KeyError, IndexError) as e:
                    print(f'[tool-convert] parse error: {e}', flush=True)

            # Check if model responded with NO_REPLY and intercept
            if method == 'POST':
                try:
                    resp_json = json.loads(data)
                    content = resp_json.get('choices', [{}])[0].get('message', {}).get('content', '')
                    if isinstance(content, str) and content.strip().upper() == 'NO_REPLY':
                        print(f'[no_reply] MODEL RETURNED NO_REPLY - intercepting!', flush=True)
                        resp_json['choices'][0]['message']['content'] = (
                            "Hey! I got your message. What's on your mind?"
                        )
                        data = json.dumps(resp_json).encode('utf-8')
                        print(f'[no_reply] replaced with fallback response', flush=True)
                except (json.JSONDecodeError, KeyError, IndexError):
                    pass

            if client_wants_stream:
                try:
                    resp_json = json.loads(data)
                    msg = resp_json.get('choices', [{}])[0].get('message', {})
                    content = msg.get('content', '') or ''
                    role = msg.get('role', 'assistant')
                    tool_calls_resp = msg.get('tool_calls')
                    finish = resp_json.get('choices', [{}])[0].get('finish_reason', 'stop')
                    resp_id = resp_json.get('id', 'chatcmpl-0')
                    created = resp_json.get('created', 0)
                    model = resp_json.get('model', original_model)

                    print(f'[proxy] response content ({len(content)} chars): {content[:200]}', flush=True)
                    if tool_calls_resp:
                        print(f'[proxy] response has {len(tool_calls_resp)} tool_calls', flush=True)

                    sse_chunks = []

                    if tool_calls_resp:
                        # Stream tool_calls in OpenAI SSE format
                        # First chunk: role + first tool call header
                        for idx, tc in enumerate(tool_calls_resp):
                            chunk_tc = {
                                'id': resp_id, 'object': 'chat.completion.chunk',
                                'created': created, 'model': model,
                                'choices': [{'index': 0, 'delta': {
                                    'role': role if idx == 0 else None,
                                    'tool_calls': [{
                                        'index': idx,
                                        'id': tc['id'],
                                        'type': 'function',
                                        'function': {
                                            'name': tc['function']['name'],
                                            'arguments': tc['function']['arguments'],
                                        }
                                    }]
                                }, 'finish_reason': None}]
                            }
                            # Clean None values
                            delta = chunk_tc['choices'][0]['delta']
                            if delta.get('role') is None:
                                del delta['role']
                            sse_chunks.append(f'data: {json.dumps(chunk_tc)}\n\n')

                        chunk_final = {
                            'id': resp_id, 'object': 'chat.completion.chunk',
                            'created': created, 'model': model,
                            'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'tool_calls'}],
                            'usage': resp_json.get('usage', {})
                        }
                        sse_chunks.append(f'data: {json.dumps(chunk_final)}\n\n')
                    else:
                        # Normal text streaming
                        chunk1 = {
                            'id': resp_id, 'object': 'chat.completion.chunk',
                            'created': created, 'model': model,
                            'choices': [{'index': 0, 'delta': {'role': role, 'content': ''}, 'finish_reason': None}]
                        }
                        sse_chunks.append(f'data: {json.dumps(chunk1)}\n\n')

                        chunk_size = 100
                        for i in range(0, max(len(content), 1), chunk_size):
                            piece = content[i:i+chunk_size]
                            chunk_n = {
                                'id': resp_id, 'object': 'chat.completion.chunk',
                                'created': created, 'model': model,
                                'choices': [{'index': 0, 'delta': {'content': piece}, 'finish_reason': None}]
                            }
                            sse_chunks.append(f'data: {json.dumps(chunk_n)}\n\n')

                        chunk_final = {
                            'id': resp_id, 'object': 'chat.completion.chunk',
                            'created': created, 'model': model,
                            'choices': [{'index': 0, 'delta': {}, 'finish_reason': finish}],
                            'usage': resp_json.get('usage', {})
                        }
                        sse_chunks.append(f'data: {json.dumps(chunk_final)}\n\n')

                    sse_chunks.append('data: [DONE]\n\n')

                    sse_body = ''.join(sse_chunks).encode('utf-8')
                    print(f'[proxy] SSE: {len(content)} chars, {len(sse_chunks)} chunks', flush=True)

                    self.send_response(resp.status)
                    self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
                    self.send_header('Cache-Control', 'no-cache')
                    self.send_header('Connection', 'close')
                    self.send_header('Content-Length', str(len(sse_body)))
                    self.end_headers()
                    self.wfile.write(sse_body)
                    self.wfile.flush()
                except Exception as conv_err:
                    print(f'[proxy] SSE conversion error: {conv_err}, sending raw', flush=True)
                    self.send_response(resp.status)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    self.wfile.flush()
            else:
                self.send_response(resp.status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                self.wfile.flush()

            print(f'[proxy] {method} {self.path} -> {resp.status}', flush=True)
            conn.close()
        except Exception as e:
            print(f'[proxy] ERROR: {e}', flush=True)
            try:
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                err = json.dumps({'error': {'message': str(e)}}).encode()
                self.send_header('Content-Length', str(len(err)))
                self.end_headers()
                self.wfile.write(err)
            except:
                pass


    def _direct_proxy(self, body_bytes, client_wants_stream, original_model, route_cfg):
        """Route request directly to a cloud API (OpenRouter) with minimal modification."""
        try:
            host = route_cfg['host']
            port = route_cfg['port']
            scheme = route_cfg['scheme']
            api_key = route_cfg['key']

            if scheme == 'https':
                conn = HTTPSConnection(host, port, context=upstream_ctx, timeout=300)
            else:
                conn = HTTPConnection(host, port, timeout=300)

            headers = {
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {api_key}',
                'HTTP-Referer': 'https://openclaw.local',
                'X-Title': 'OpenClaw Agent',
            }
            if body_bytes is not None:
                headers['Content-Length'] = str(len(body_bytes))

            conn.request('POST', '/api/v1/chat/completions', body=body_bytes, headers=headers)
            resp = conn.getresponse()
            data = resp.read()

            print(f'[direct] {original_model} -> {host} status={resp.status} ({len(data)} bytes)', flush=True)
            # Debug: show raw response for troubleshooting
            print(f'[direct] raw: {data[:600]}', flush=True)

            if resp.status >= 400:
                print(f'[direct] ERROR body: {data[:500]}', flush=True)

            if client_wants_stream:
                # Convert non-streaming response to SSE format
                try:
                    resp_json = json.loads(data)
                    msg = resp_json.get('choices', [{}])[0].get('message', {})
                    content = msg.get('content', '') or ''
                    role = msg.get('role', 'assistant')
                    tool_calls_resp = msg.get('tool_calls')
                    finish = resp_json.get('choices', [{}])[0].get('finish_reason', 'stop')
                    resp_id = resp_json.get('id', 'chatcmpl-0')
                    created = resp_json.get('created', 0)
                    model = original_model  # Keep our model name

                    sse_chunks = []

                    if tool_calls_resp:
                        for idx, tc in enumerate(tool_calls_resp):
                            chunk_tc = {
                                'id': resp_id, 'object': 'chat.completion.chunk',
                                'created': created, 'model': model,
                                'choices': [{'index': 0, 'delta': {
                                    'tool_calls': [{
                                        'index': idx,
                                        'id': tc['id'],
                                        'type': 'function',
                                        'function': {
                                            'name': tc['function']['name'],
                                            'arguments': tc['function']['arguments'],
                                        }
                                    }]
                                }, 'finish_reason': None}]
                            }
                            if idx == 0:
                                chunk_tc['choices'][0]['delta']['role'] = role
                            sse_chunks.append(f'data: {json.dumps(chunk_tc)}' + '\n\n')

                        chunk_final = {
                            'id': resp_id, 'object': 'chat.completion.chunk',
                            'created': created, 'model': model,
                            'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'tool_calls'}],
                            'usage': resp_json.get('usage', {})
                        }
                        sse_chunks.append(f'data: {json.dumps(chunk_final)}' + '\n\n')
                    else:
                        chunk1 = {
                            'id': resp_id, 'object': 'chat.completion.chunk',
                            'created': created, 'model': model,
                            'choices': [{'index': 0, 'delta': {'role': role, 'content': ''}, 'finish_reason': None}]
                        }
                        sse_chunks.append(f'data: {json.dumps(chunk1)}' + '\n\n')
                        chunk_size = 100
                        for i in range(0, max(len(content), 1), chunk_size):
                            piece = content[i:i+chunk_size]
                            chunk_n = {
                                'id': resp_id, 'object': 'chat.completion.chunk',
                                'created': created, 'model': model,
                                'choices': [{'index': 0, 'delta': {'content': piece}, 'finish_reason': None}]
                            }
                            sse_chunks.append(f'data: {json.dumps(chunk_n)}' + '\n\n')
                        chunk_final = {
                            'id': resp_id, 'object': 'chat.completion.chunk',
                            'created': created, 'model': model,
                            'choices': [{'index': 0, 'delta': {}, 'finish_reason': finish}],
                            'usage': resp_json.get('usage', {})
                        }
                        sse_chunks.append(f'data: {json.dumps(chunk_final)}' + '\n\n')

                    sse_chunks.append('data: [DONE]\n\n')
                    sse_body = ''.join(sse_chunks).encode('utf-8')

                    self.send_response(200)
                    self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
                    self.send_header('Cache-Control', 'no-cache')
                    self.send_header('Connection', 'close')
                    self.send_header('Content-Length', str(len(sse_body)))
                    self.end_headers()
                    self.wfile.write(sse_body)
                    self.wfile.flush()
                    print(f'[direct] SSE: {len(content)} chars text, {len(tool_calls_resp or [])} tool_calls', flush=True)
                except Exception as e:
                    print(f'[direct] SSE conversion error: {e}, sending raw', flush=True)
                    self.send_response(resp.status)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    self.wfile.flush()
            else:
                # Non-streaming: rewrite model name and pass through
                try:
                    resp_json = json.loads(data)
                    resp_json['model'] = original_model
                    data = json.dumps(resp_json).encode('utf-8')
                except:
                    pass
                self.send_response(resp.status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                self.wfile.flush()

            conn.close()
        except Exception as e:
            print(f'[direct] ERROR: {e}', flush=True)
            try:
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                err = json.dumps({'error': {'message': f'Direct proxy error: {e}'}}).encode()
                self.send_header('Content-Length', str(len(err)))
                self.end_headers()
                self.wfile.write(err)
            except:
                pass

    def log_message(self, fmt, *args):
        pass

class ThreadedHTTPServer(HTTPServer):
    def process_request(self, request, client_address):
        t = threading.Thread(target=self._handle, args=(request, client_address))
        t.daemon = True
        t.start()
    def _handle(self, request, client_address):
        try:
            self.finish_request(request, client_address)
        except Exception:
            self.handle_error(request, client_address)
        finally:
            self.shutdown_request(request)

if __name__ == '__main__':
    cert_file, key_file = generate_self_signed_cert()
    print('Generated self-signed TLS cert', flush=True)
    server = ThreadedHTTPServer(('0.0.0.0', PORT), ProxyHandler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert_file, key_file)
    server.socket = ctx.wrap_socket(server.socket, server_side=True)
    print(f'HTTPS model proxy :{PORT} -> {UPSTREAM} (threaded, HTTP/1.1)', flush=True)
    print(f'Maps: {json.dumps(MODEL_MAP)}', flush=True)
    print(f'Strips: {UNSUPPORTED_PARAMS}', flush=True)
    print(f'Web search: {"enabled" if HAS_DDGS else "DISABLED (pip install duckduckgo-search)"}', flush=True)
    server.serve_forever()

