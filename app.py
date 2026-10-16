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
  without permission), which also protects against CSRF.
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

CATEGORIES = (
    "Information Accessibility",
    "Quality & Condition",
    "Responsiveness",
)


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
    MAX_CONTENT_LENGTH=4 * 1024 * 1024,
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
               r.text, r.image, r.created_at, r.status
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

IMAGE_PATTERN = re.compile(
    r"^data:image/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$"
)


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

    if image and (
        not isinstance(image, str)
        or len(image) > 3_000_000
        or not IMAGE_PATTERN.match(image)
    ):
        return error("Please choose a valid image smaller than 2MB.")

    db = get_db()

    db.execute(
        "INSERT INTO reviews (user_id, category, rating, text, image) "
        "VALUES (?, ?, ?, ?, ?)",
        (g.user["id"], category, rating, text, image),
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

    message = clean(data.get("message"), 2000)

    contact_type = data.get("contact_type")

    contact_value = clean(data.get("contact_value"), 254)

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
        "INSERT INTO guest_feedback (message, contact_type, contact_value) "
        "VALUES (?, ?, ?)",
        (message, contact_type, contact_value),
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
            "SELECT id, message, contact_type, contact_value, status, "
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
init_db()


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=os.environ.get("CAMPUSVOICE_DEBUG") == "1",
    )
