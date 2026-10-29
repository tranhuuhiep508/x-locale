"""Column length limits shared by the ORM and request validation.

Migrations keep their own literals. These constants are the live contract:
user and CLI input must be rejected before it can overflow a varchar, or the
column must be wide enough for every value the API already accepts.
"""

KEY_MAX_LENGTH = 512
# Text columns stay unbounded in the database. These caps reject new writes only.
TEXT_MAX_LENGTH = 32768
IMPORT_MAX_BYTES = 20 * 1024 * 1024
# Allow multipart headers and boundaries in addition to the file itself.
IMPORT_REQUEST_MAX_BYTES = IMPORT_MAX_BYTES + 1024 * 1024
EXCEL_CELL_MAX_LENGTH = 32767
EXCEL_MAX_EXPANDED_BYTES = 64 * 1024 * 1024
EXCEL_MAX_MEMBER_BYTES = 32 * 1024 * 1024
EXCEL_MAX_MEMBERS = 1024
EXCEL_MAX_SHEETS = 128
EXCEL_MAX_ROWS = 100_000
EXCEL_MAX_COLUMNS = 256
EXCEL_MAX_CELLS = 1_000_000
EXCEL_MAX_DECODED_CHARACTERS = 64 * 1024 * 1024
MODULE_SLUG_MAX_LENGTH = 128
MODULE_NAME_MAX_LENGTH = 255
TAG_NAME_MAX_LENGTH = 128
TAG_COLOR_MAX_LENGTH = 32
PROJECT_NAME_MAX_LENGTH = 255
PROJECT_SLUG_MAX_LENGTH = 128
# Locale regex matches at most 12 characters (aaa-12345678). 16 leaves room
# for that tag without overflowing translations.locale.
LOCALE_MAX_LENGTH = 16
EMAIL_MAX_LENGTH = 320
USER_NAME_MAX_LENGTH = 255
AVATAR_URL_MAX_LENGTH = 1024
OIDC_SUB_MAX_LENGTH = 512
OIDC_ISSUER_MAX_LENGTH = 512
# Actor labels copy users.email, which is longer than the old varchar(255).
ACTOR_LABEL_MAX_LENGTH = 320
API_KEY_NAME_MAX_LENGTH = 255
