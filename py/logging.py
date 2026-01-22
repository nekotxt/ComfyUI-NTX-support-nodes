ADDON_NAME = ""
LOG_INFO = True
LOG_INFO_NODE_NAME = True
LOG_INFO_LOAD_MODEL = True
LOG_INFO_APPLY_MODEL = True
LOG_WARNING = True

# https://stackoverflow.com/questions/4842424/list-of-ansi-color-escape-sequences
# https://en.wikipedia.org/wiki/ANSI_escape_code#3-bit_and_4-bit
COLORS = {
  'BLACK': '\33[30m',
  'RED': '\33[31m',
  'GREEN': '\33[32m',
  'YELLOW': '\33[33m',
  'BLUE': '\33[34m',
  'MAGENTA': '\33[35m',
  'CYAN': '\33[36m',
  'WHITE': '\33[37m',
  'GREY': '\33[90m',
  'BRIGHT_RED': '\33[91m',
  'BRIGHT_GREEN': '\33[92m',
  'BRIGHT_YELLOW': '\33[93m',
  'BRIGHT_BLUE': '\33[94m',
  'BRIGHT_MAGENTA': '\33[95m',
  'BRIGHT_CYAN': '\33[96m',
  'BRIGHT_WHITE': '\33[97m',
  # Styles.
  'RESET': '\33[0m',
  'BOLD': '\33[1m',
  'NORMAL': '\33[22m',
  'ITALIC': '\33[3m',
  'UNDERLINE': '\33[4m',
  'BLINK': '\33[5m',
  'BLINK2': '\33[6m',
  'SELECTED': '\33[7m',
  # Backgrounds
  'BG_BLACK': '\33[40m',
  'BG_RED': '\33[41m',
  'BG_GREEN': '\33[42m',
  'BG_YELLOW': '\33[43m',
  'BG_BLUE': '\33[44m',
  'BG_MAGENTA': '\33[45m',
  'BG_CYAN': '\33[46m',
  'BG_WHITE': '\33[47m',
  'BG_GREY': '\33[100m',
  'BG_BRIGHT_RED': '\33[101m',
  'BG_BRIGHT_GREEN': '\33[102m',
  'BG_BRIGHT_YELLOW': '\33[103m',
  'BG_BRIGHT_BLUE': '\33[104m',
  'BG_BRIGHT_MAGENTA': '\33[105m',
  'BG_BRIGHT_CYAN': '\33[106m',
  'BG_BRIGHT_WHITE': '\33[107m',
}

def log_setup(addon_name:str, show_info:bool, show_info_node_name:bool, show_info_load_model:bool, show_info_apply_model:bool, show_warning:bool):
  global ADDON_NAME, LOG_INFO, LOG_INFO_NODE_NAME, LOG_INFO_LOAD_MODEL, LOG_INFO_APPLY_MODEL, LOG_WARNING

  ADDON_NAME = addon_name
  log_info(f"ADDON_NAME = {ADDON_NAME}")

  LOG_INFO = show_info
  log_info(f"LOG_INFO = {LOG_INFO}")

  LOG_INFO_NODE_NAME = show_info_node_name
  log_info(f"LOG_INFO_NODE_NAME = {LOG_INFO_NODE_NAME}")

  LOG_INFO_LOAD_MODEL = show_info_load_model
  log_info(f"LOG_INFO_LOAD_MODEL = {LOG_INFO_LOAD_MODEL}")

  LOG_INFO_APPLY_MODEL = show_info_apply_model
  log_info(f"LOG_INFO_APPLY_MODEL = {LOG_INFO_APPLY_MODEL}")

  LOG_WARNING = show_warning
  log_info(f"LOG_WARNING = {LOG_WARNING}")

def log(message, color=None, msg_color=None, prefix=None):
  """Basic logging."""
  color = COLORS[color] if color is not None and color in COLORS else COLORS["BRIGHT_GREEN"]
  msg_color = COLORS[msg_color] if msg_color is not None and msg_color in COLORS else ''
  prefix = f'[{prefix}]' if prefix is not None else ''
  msg = f'{color}[{ADDON_NAME}]{prefix}{msg_color} {message}{COLORS["RESET"]}'
  print(msg)


def log_success(message):
  """Logs a success message."""
  if LOG_INFO:
    log(message, color="BRIGHT_GREEN", msg_color='RESET')

def log_info(message):
  """Logs an info message."""
  if LOG_INFO:
    log(message, color="CYAN", msg_color='RESET')

def log_info_loadmodel(message):
  """Logs an info message."""
  if LOG_INFO_LOAD_MODEL:
    log(message, color="BRIGHT_BLUE", msg_color='RESET')

def log_info_applymodel(message):
  """Logs an info message."""
  if LOG_INFO_APPLY_MODEL:
    log(message, color="YELLOW", msg_color='RESET')

def log_node_name(name, totalLenght = 100):
  if LOG_INFO_NODE_NAME:
    #print("=" * totalLenght)
    log(f"=== {name} {'=' * (totalLenght - 3 - 1 - len(name) - 1)}", color="CYAN", msg_color='RESET')
    #print("=" * totalLenght)

def log_warning(message, msg_color='RESET'):
  """Logs a warning message."""
  if LOG_WARNING:
    log(message, color="BRIGHT_RED", msg_color='RESET')
