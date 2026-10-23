"""
CampusVoice backend (Flask + SQLite).

Run:
    pip install -r requirements.txt
    python app.py
Then open http://127.0.0.1:5000

- Accounts, posts, likes/dislikes, replies and reports are saved in
  campusvoice.db (created automatically next to this file).
- Passwords are hashed. A login is kept in Flask's signed session cookie.
- Every /api route except signup and login needs a logged-in session.
- Write requests must send JSON (browsers can't send that cross-site
  without permission), which also protects against CSRF. The one
  exception is the media upload, which sends a custom header instead
  (browsers can't add that cross-site without permission either).
- Photos and videos are uploaded to /api/media and saved in the uploads
  folder (created automatically). Posts only store the file's URL.
"""

import os
import re
import secrets
import sqlite3
from collections import defaultdict
from datetime import timedelta
from functools import wraps

from flask import (
    Flask,
    g,
    jsonify,
    request,
    send_from_directory,
    session,
)
from werkzeug.security import check_password_hash, generate_password_hash


BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DB_PATH = os.path.join(BASE_DIR, "campusvoice.db")

SECRET_PATH = os.path.join(BASE_DIR, ".secret_key")

UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")

MB = 1024 * 1024

# Media size limits. Static/script.js has matching numbers so the page can
# warn before uploading, but these are the ones that actually count.
MAX_IMAGE_BYTES = 5 * MB        # the page shrinks photos to WebP first
MAX_VIDEO_BYTES = 30 * MB
MAX_LIVE_VIDEO_BYTES = 8 * MB   # the short clip that goes with a Live Photo
MAX_JSON_BYTES = 4 * MB         # every request except the media upload

CATEGORIES = (
    "Information Accessibility",
    "Quality & Condition",
    "Responsiveness",
)

# Roles a guest can pick on the public feedback form
GUEST_ROLES = ("Student", "Faculty", "Staff", "Guest")


def load_secret_key():
    """Use SECRET_KEY if set, otherwise create and reuse a local key file."""

    if os.environ.get("SECRET_KEY"):
        return os.environ["SECRET_KEY"]

    if os.path.exists(SECRET_PATH):
        with open(SECRET_PATH, "r", encoding="utf-8") as file:
            return file.read().strip()

    key = secrets.token_hex(32)

    with open(SECRET_PATH, "w", encoding="utf-8") as file:
        file.write(key)

    return key


app = Flask(
    __name__,
    static_folder="Static",
    static_url_path="/static",
)

app.config.update(
    SECRET_KEY=load_secret_key(),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    PERMANENT_SESSION_LIFETIME=timedelta(days=7),
    # Big enough for the largest video plus the upload envelope. Everything
    # that isn't the media upload is held to MAX_JSON_BYTES (see below).
    MAX_CONTENT_LENGTH=MAX_VIDEO_BYTES + MB,
    SEND_FILE_MAX_AGE_DEFAULT=0,
)


# =========================================================
# DATABASE
# =========================================================

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    student_number TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS reviews (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category   TEXT NOT NULL,
    rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    text       TEXT NOT NULL,
    image      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- One row per user per post. The primary key is what makes a
-- duplicate like impossible, even if someone skips the web page.
CREATE TABLE IF NOT EXISTS reactions (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    kind      TEXT NOT NULL CHECK (kind IN ('like', 'dislike')),
    PRIMARY KEY (user_id, review_id)
);

CREATE TABLE IF NOT EXISTS replies (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id  INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS reports (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id  INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason     TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS guest_feedback (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    message       TEXT NOT NULL,
    contact_type  TEXT NOT NULL CHECK (contact_type IN ('email', 'mobile', 'facebook')),
    contact_value TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE TABLE IF NOT EXISTS surveys (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    url        TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
"""


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")

    return g.db


@app.teardown_appcontext
def close_db(_error):
    db = g.pop("db", None)

    if db is not None:
        db.close()


def init_db():
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    db = sqlite3.connect(DB_PATH)

    db.executescript(SCHEMA)

    user_cols = [row[1] for row in db.execute("PRAGMA table_info(users)")]

    if "is_admin" not in user_cols:
        db.execute(
            "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0"
        )

    review_cols = [row[1] for row in db.execute("PRAGMA table_info(reviews)")]

    if "status" not in review_cols:
        db.execute(
            "ALTER TABLE reviews ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'"
        )

    if "video" not in review_cols:
        # URL of an uploaded video ('' when the post has none)
        db.execute(
            "ALTER TABLE reviews ADD COLUMN video TEXT NOT NULL DEFAULT ''"
        )

    if "is_live" not in review_cols:
        # 1 when image + video together make a Live Photo
        db.execute(
            "ALTER TABLE reviews ADD COLUMN is_live INTEGER NOT NULL DEFAULT 0"
        )

    guest_cols = [
        row[1] for row in db.execute("PRAGMA table_info(guest_feedback)")
    ]

    if "role" not in guest_cols:
        # Older rows (before roles existed) stay as an empty role
        db.execute(
            "ALTER TABLE guest_feedback ADD COLUMN role TEXT NOT NULL DEFAULT ''"
        )

    db.commit()

    db.close()


# =========================================================
# HELPERS
# =========================================================

def error(message, status=400):
    return jsonify(error=message), status


def json_body():
    """The JSON object sent by the page, or None."""

    data = request.get_json(silent=True)

    return data if isinstance(data, dict) else None


def clean(value, max_length):
    """Trimmed string, or None if it isn't text or is too long."""

    if not isinstance(value, str):
        return None

    value = value.strip()

    return value if len(value) <= max_length else None


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        user = None

        if "uid" in session:
            user = get_db().execute(
                "SELECT id, username, student_number, created_at, is_admin "
                "FROM users WHERE id = ?",
                (session["uid"],),
            ).fetchone()

        if user is None:
            session.clear()

            return error("Please log in first.", 401)

        g.user = user

        return view(*args, **kwargs)

    return wrapper


def user_json(user):
    return {
        "id": user["id"],
        "username": user["username"],
        "student_number": user["student_number"],
        "created_at": user["created_at"],
        "is_admin": bool(user["is_admin"]),
    }


def fetch_reviews(review_id=None):
    """All posts (newest first), or just one. Counts come from the database."""

    db = get_db()

    where = "WHERE r.id = ?" if review_id else ""

    args = (review_id,) if review_id else ()

    reviews = db.execute(
        f"""
        SELECT r.id, r.user_id, u.username, r.category, r.rating,
               r.text, r.image, r.video, r.is_live, r.created_at, r.status
          FROM reviews r
          JOIN users u ON u.id = r.user_id
          {where}
         ORDER BY r.created_at DESC, r.id DESC
        """,
        args,
    ).fetchall()

    # Who reacted how (one query for every post)
    likes = defaultdict(list)

    dislikes = defaultdict(int)

    mine = {}

    for row in db.execute(
        "SELECT x.review_id, x.kind, x.user_id, u.username "
        "FROM reactions x JOIN users u ON u.id = x.user_id "
        "ORDER BY x.rowid"
    ):
        if row["kind"] == "like":
            likes[row["review_id"]].append(row["username"])
        else:
            dislikes[row["review_id"]] += 1

        if row["user_id"] == g.user["id"]:
            mine[row["review_id"]] = row["kind"]

    replies = defaultdict(list)

    for row in db.execute(
        "SELECT p.review_id, u.username, p.text, p.created_at "
        "FROM replies p JOIN users u ON u.id = p.user_id "
        "ORDER BY p.id"
    ):
        replies[row["review_id"]].append({
            "username": row["username"],
            "text": row["text"],
            "date": row["created_at"],
        })

    return [
        {
            "id": row["id"],
            "user_id": row["user_id"],
            "username": row["username"],
            "category": row["category"],
            "rating": row["rating"],
            "text": row["text"],
            "image": row["image"],
            "video": row["video"],
            "live": bool(row["is_live"]),
            "date": row["created_at"],
            "status": row["status"],
            "likes": len(likes[row["id"]]),
            "liked_by": likes[row["id"]],
            "dislikes": dislikes[row["id"]],
            "my_reaction": mine.get(row["id"]),
            "replies": replies[row["id"]],
        }
        for row in reviews
    ]


@app.errorhandler(404)
def not_found(_error):
    return error("Not found.", 404)


@app.errorhandler(405)
def not_allowed(_error):
    return error("Method not allowed.", 405)


@app.errorhandler(413)
def too_large(_error):
    return error("That upload is too large.", 413)


@app.before_request
def limit_json_size():
    """Only the media upload may be big; everything else stays small."""

    if (
        request.endpoint != "upload_media"
        and (request.content_length or 0) > MAX_JSON_BYTES
    ):
        return error("That upload is too large.", 413)


# =========================================================
# PAGE
# =========================================================

@app.get("/")
def index():
    return send_from_directory(
        os.path.join(BASE_DIR, "Template"),
        "index.html",
    )


# =========================================================
# ACCOUNTS
# =========================================================

USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.\-]{2,29}$")

# Exactly like 21-0123-456
STUDENT_NUMBER_PATTERN = re.compile(r"^[0-9]{2}-[0-9]{4}-[0-9]{3}$")


@app.post("/api/signup")
def signup():
    data = json_body()

    if data is None:
        return error("Invalid request.")

    username = clean(data.get("username"), 30)

    student_number = clean(data.get("student_number"), 11)

    password = data.get("password")

    if not username or not student_number or not isinstance(password, str):
        return error("Please complete all fields.")

    if not USERNAME_PATTERN.match(username):
        return error(
            "Username must be 3-30 characters: letters, numbers, "
            "spaces, dots, dashes or underscores."
        )

    if not STUDENT_NUMBER_PATTERN.match(student_number):
        return error("Student number must look like 21-0123-456.")

    if not 6 <= len(password) <= 128:
        return error("Password must contain at least 6 characters.")

    db = get_db()

    try:
        db.execute(
            "INSERT INTO users (username, student_number, password_hash) "
            "VALUES (?, ?, ?)",
            (username, student_number, generate_password_hash(password)),
        )
        db.commit()
    except sqlite3.IntegrityError:
        return error("That username is already registered.", 409)

    return jsonify(ok=True), 201


@app.post("/api/login")
def login():
    data = json_body()

    if data is None:
        return error("Invalid request.")

    username = clean(data.get("username"), 30)

    password = data.get("password")

    if not username or not isinstance(password, str):
        return error("Please enter your username and password.")

    user = get_db().execute(
        "SELECT * FROM users WHERE username = ?",
        (username,),
    ).fetchone()

    if user is None or not check_password_hash(user["password_hash"], password):
        return error("Incorrect username or password.", 401)

    session.clear()

    session["uid"] = user["id"]

    session.permanent = True

    return jsonify(user=user_json(user))


@app.post("/api/logout")
def logout():
    session.clear()

    return jsonify(ok=True)


@app.get("/api/me")
@login_required
def me():
    return jsonify(user=user_json(g.user))


# =========================================================
# POSTS
# =========================================================

# Older posts keep their photo inside the database as a data URL.
# New photos and videos are uploaded as files instead (see below).
IMAGE_PATTERN = re.compile(
    r"^data:image/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$"
)

# What an uploaded file may be: extension -> (kind, Content-Type it is sent as)
# .mov (iPhone / QuickTime) uses the same container as .mp4, and labelling it
# video/mp4 lets more browsers play it.
MEDIA_TYPES = {
    ".jpg": ("image", "image/jpeg"),
    ".png": ("image", "image/png"),
    ".gif": ("image", "image/gif"),
    ".webp": ("image", "image/webp"),
    ".mp4": ("video", "video/mp4"),
    ".mov": ("video", "video/mp4"),
    ".webm": ("video", "video/webm"),
}

# Stored files are named with 32 random hex characters plus an extension
MEDIA_NAME = re.compile(r"^[0-9a-f]{32}(\.[a-z0-9]{3,4})$")

# MP4-family brands that are really photos or audio, not video
NOT_VIDEO_BRANDS = (
    b"heic", b"heix", b"heim", b"heis", b"hevc", b"hevx",
    b"mif1", b"msf1", b"avif", b"avis",
    b"M4A ", b"M4B ", b"M4P ",
)


def sniff_media(head):
    """Work out what a file really is from its first bytes.

    The file name and the browser's Content-Type are easy to fake, so only
    the file's own signature is trusted. Returns the extension to store it
    under (a key of MEDIA_TYPES), or None if it is not an allowed type.
    """

    if head.startswith(b"\xff\xd8\xff"):
        return ".jpg"

    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"

    if head[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"

    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp"

    # WebM and Matroska share a header; the DocType says which one it is
    if head[:4] == b"\x1a\x45\xdf\xa3" and b"webm" in head:
        return ".webm"

    if head[4:8] == b"ftyp":
        brand = head[8:12]

        if brand in NOT_VIDEO_BRANDS:
            return None

        return ".mov" if brand == b"qt  " else ".mp4"

    return None


def stored_media_path(url, kind):
    """Path on disk for an uploaded file's '/media/<name>' URL.

    Returns None unless the URL is one of ours, is the right kind of file
    ('image' or 'video') and still exists.
    """

    if not isinstance(url, str) or not url.startswith("/media/"):
        return None

    name = url[len("/media/"):]

    match = MEDIA_NAME.match(name)

    if not match or match.group(1) not in MEDIA_TYPES:
        return None

    if MEDIA_TYPES[match.group(1)][0] != kind:
        return None

    path = os.path.join(UPLOAD_DIR, name)

    return path if os.path.isfile(path) else None


@app.post("/api/media")
@login_required
def upload_media():
    """Save one photo or video and return its URL.

    The page sends it as multipart form data with a 'file' field. The
    custom header stands in for the JSON-only rule: a web page on another
    site can't add it without the browser asking this server first.
    """

    if request.headers.get("X-CampusVoice-Upload") != "1":
        return error("Invalid request.")

    upload = request.files.get("file")

    if upload is None:
        return error("Please choose a file to upload.")

    head = upload.stream.read(64)

    upload.stream.seek(0, os.SEEK_END)

    size = upload.stream.tell()

    upload.stream.seek(0)

    extension = sniff_media(head)

    if extension is None:
        return error(
            "Unsupported file. Please use a JPG, PNG, WebP or GIF photo, "
            "or an MP4, WebM or MOV video."
        )

    kind, mime = MEDIA_TYPES[extension]

    limit = MAX_IMAGE_BYTES if kind == "image" else MAX_VIDEO_BYTES

    if size == 0:
        return error("That file is empty.")

    if size > limit:
        return error(
            f"That {kind} is too large (the limit is {limit // MB} MB).",
            413,
        )

    name = secrets.token_hex(16) + extension

    upload.save(os.path.join(UPLOAD_DIR, name))

    return jsonify(
        url="/media/" + name,
        kind=kind,
        mime=mime,
        size=size,
    ), 201


@app.get("/media/<name>")
@login_required
def serve_media(name):
    """Send an uploaded file. Range requests work, so videos can seek."""

    match = MEDIA_NAME.match(name)

    if not match or match.group(1) not in MEDIA_TYPES:
        return error("Not found.", 404)

    response = send_from_directory(
        UPLOAD_DIR,
        name,
        mimetype=MEDIA_TYPES[match.group(1)][1],
        conditional=True,
        max_age=86400,
    )

    # Only logged-in users may see these, so keep them out of shared caches
    response.cache_control.public = False
    response.cache_control.private = True

    response.headers["X-Content-Type-Options"] = "nosniff"

    return response


@app.get("/api/reviews")
@login_required
def list_reviews():
    return jsonify(reviews=fetch_reviews())


@app.post("/api/reviews")
@login_required
def create_review():
    data = json_body()

    if data is None:
        return error("Invalid request.")

    category = data.get("category")

    rating = data.get("rating")

    text = clean(data.get("text"), 2000)

    image = data.get("image") or ""

    video = data.get("video") or ""

    live = data.get("live") is True

    if category not in CATEGORIES:
        return error("Please choose a feedback area.")

    if (
        not isinstance(rating, int)
        or isinstance(rating, bool)
        or not 1 <= rating <= 5
    ):
        return error("Please select a rating from 1 to 5 stars.")

    if not text:
        return error("Please write your feedback (up to 2000 characters).")

    if image:
        if not isinstance(image, str):
            return error("Please choose a valid photo.")

        if image.startswith("/media/"):
            # A photo uploaded through /api/media
            if stored_media_path(image, "image") is None:
                return error("Please choose a valid photo.")

        elif len(image) > 3_000_000 or not IMAGE_PATTERN.match(image):
            # An inline photo, as older versions of the page sent
            return error("Please choose a valid image smaller than 2MB.")

    video_path = None

    if video:
        video_path = stored_media_path(video, "video")

        if video_path is None:
            return error("Please choose a valid video.")

    if live:
        if not image or not video_path:
            return error("A Live Photo needs both a photo and its short video.")

        if os.path.getsize(video_path) > MAX_LIVE_VIDEO_BYTES:
            return error(
                "The Live Photo video is too large "
                f"(the limit is {MAX_LIVE_VIDEO_BYTES // MB} MB)."
            )

    db = get_db()

    db.execute(
        "INSERT INTO reviews "
        "(user_id, category, rating, text, image, video, is_live) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (g.user["id"], category, rating, text, image, video, int(live)),
    )

    db.commit()

    return jsonify(ok=True), 201


def review_exists(review_id):
    return get_db().execute(
        "SELECT 1 FROM reviews WHERE id = ?",
        (review_id,),
    ).fetchone() is not None


@app.post("/api/reviews/<int:review_id>/react")
@login_required
def react(review_id):
    """Like / dislike a post. Sending the same one again undoes it."""

    data = json_body()

    kind = data.get("kind") if data else None

    if kind not in ("like", "dislike"):
        return error("Invalid reaction.")

    if not review_exists(review_id):
        return error("That post no longer exists.", 404)

    db = get_db()

    existing = db.execute(
        "SELECT kind FROM reactions WHERE user_id = ? AND review_id = ?",
        (g.user["id"], review_id),
    ).fetchone()

    if existing and existing["kind"] == kind:
        db.execute(
            "DELETE FROM reactions WHERE user_id = ? AND review_id = ?",
            (g.user["id"], review_id),
        )
    elif existing:
        db.execute(
            "UPDATE reactions SET kind = ? "
            "WHERE user_id = ? AND review_id = ?",
            (kind, g.user["id"], review_id),
        )
    else:
        db.execute(
            "INSERT INTO reactions (user_id, review_id, kind) "
            "VALUES (?, ?, ?)",
            (g.user["id"], review_id, kind),
        )

    db.commit()

    return jsonify(review=fetch_reviews(review_id)[0])


@app.post("/api/reviews/<int:review_id>/reply")
@login_required
def reply(review_id):
    data = json_body()

    text = clean(data.get("text"), 1000) if data else None

    if not text:
        return error("Please write a reply (up to 1000 characters).")

    if not review_exists(review_id):
        return error("That post no longer exists.", 404)

    db = get_db()

    db.execute(
        "INSERT INTO replies (review_id, user_id, text) VALUES (?, ?, ?)",
        (review_id, g.user["id"], text),
    )

    db.commit()

    return jsonify(ok=True), 201


@app.post("/api/reviews/<int:review_id>/report")
@login_required
def report(review_id):
    data = json_body()

    reason = clean(data.get("reason"), 500) if data else None

    if not reason:
        return error("Please give a reason (up to 500 characters).")

    if not review_exists(review_id):
        return error("That post no longer exists.", 404)

    db = get_db()

    db.execute(
        "INSERT INTO reports (review_id, user_id, reason) VALUES (?, ?, ?)",
        (review_id, g.user["id"], reason),
    )

    db.commit()

    return jsonify(ok=True), 201

# =========================================================
# GUEST FEEDBACK (public, no login needed)
# =========================================================

GUEST_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")

GUEST_MOBILE = re.compile(r"^(09\d{9}|\+639\d{9})$")


@app.post("/api/guest-feedback")
def guest_feedback():
    data = json_body()

    if data is None:
        return error("Invalid request.")

    role = data.get("role")

    message = clean(data.get("message"), 2000)

    contact_type = data.get("contact_type")

    contact_value = clean(data.get("contact_value"), 254)

    if role not in GUEST_ROLES:
        return error(
            "Please select your role: Student, Faculty, Staff, or Guest."
        )

    if not message or len(message) < 10:
        return error("Please write at least 10 characters.")

    if contact_type not in ("email", "mobile", "facebook") or not contact_value:
        return error("Please give a valid way to contact you.")

    if contact_type == "email" and not GUEST_EMAIL.match(contact_value):
        return error("Please enter a valid email address.")

    if contact_type == "mobile" and not GUEST_MOBILE.match(contact_value):
        return error("Please enter a valid PH mobile number.")

    db = get_db()

    db.execute(
        "INSERT INTO guest_feedback "
        "(role, message, contact_type, contact_value) "
        "VALUES (?, ?, ?, ?)",
        (role, message, contact_type, contact_value),
    )

    db.commit()

    return jsonify(ok=True), 201


# =========================================================
# ADMIN WORKLOAD TRACKING
# =========================================================

def admin_required(view):
    @login_required
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not g.user["is_admin"]:
            return error("Admins only.", 403)

        return view(*args, **kwargs)

    return wrapper


@app.get("/api/admin/workload")
@admin_required
def admin_workload():
    db = get_db()

    posts = [
        dict(row) for row in db.execute(
            "SELECT r.id, u.username, r.category, r.rating, r.text, "
            "r.status, r.created_at AS date "
            "FROM reviews r JOIN users u ON u.id = r.user_id "
            "ORDER BY r.created_at DESC, r.id DESC"
        )
    ]

    guests = [
        dict(row) for row in db.execute(
            "SELECT id, role, message, contact_type, contact_value, status, "
            "created_at AS date FROM guest_feedback "
            "ORDER BY created_at DESC, id DESC"
        )
    ]

    items = posts + guests

    pending = sum(1 for item in items if item["status"] == "pending")

    return jsonify(
        counts={
            "pending": pending,
            "completed": len(items) - pending,
            "total": len(items),
        },
        posts=posts,
        guests=guests,
    )


def set_status(table, item_id):
    data = json_body()

    status = data.get("status") if data else None

    if status not in ("pending", "completed"):
        return error("Invalid status.")

    db = get_db()

    cursor = db.execute(
        f"UPDATE {table} SET status = ? WHERE id = ?",
        (status, item_id),
    )

    db.commit()

    if cursor.rowcount == 0:
        return error("Not found.", 404)

    return jsonify(ok=True)


@app.post("/api/admin/posts/<int:item_id>/status")
@admin_required
def admin_post_status(item_id):
    return set_status("reviews", item_id)


@app.post("/api/admin/guests/<int:item_id>/status")
@admin_required
def admin_guest_status(item_id):
    return set_status("guest_feedback", item_id)

GOOGLE_LINK = re.compile(
    r"^https://docs\.google\.com/(document|forms|spreadsheets|presentation)/d/(e/)?([A-Za-z0-9_-]+)"
)


def to_embed_url(link):
    match = GOOGLE_LINK.match(link.strip())
    if not match:
        return None
    kind, e, doc_id = match.groups()
    base = f"https://docs.google.com/{kind}/d/{e or ''}{doc_id}"
    return base + ("/viewform?embedded=true" if kind == "forms" else "/preview")


@app.get("/api/surveys")
@login_required
def list_surveys():
    rows = get_db().execute(
        "SELECT id, title, url FROM surveys ORDER BY id DESC"
    ).fetchall()
    return jsonify(surveys=[dict(r) for r in rows])


@app.post("/api/admin/surveys")
@admin_required
def add_survey():
    data = json_body() or {}
    title = str(data.get("title", "")).strip()[:100]
    url = to_embed_url(str(data.get("url", "")))
    if not title:
        return error("Please enter a title.")
    if not url:
        return error("Paste a full Google Docs, Forms, Sheets or Slides link.")
    db = get_db()
    db.execute("INSERT INTO surveys (title, url) VALUES (?, ?)", (title, url))
    db.commit()
    return jsonify(ok=True)


@app.post("/api/admin/surveys/<int:survey_id>/delete")
@admin_required
def delete_survey(survey_id):
    db = get_db()
    db.execute("DELETE FROM surveys WHERE id = ?", (survey_id,))
    db.commit()
    return jsonify(ok=True)
    
    
init_db()


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=os.environ.get("CAMPUSVOICE_DEBUG") == "1",
    )
