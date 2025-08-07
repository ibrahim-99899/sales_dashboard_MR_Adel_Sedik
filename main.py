from flask import Flask, jsonify, render_template, request, redirect, url_for
import requests
import os
import json
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
from datetime import datetime
from dateutil import parser as date_parser

app = Flask(__name__)
load_dotenv()

# ========= Constants =========
DATA_FILE = "data.json"
UPLOAD_PHOTOS = "static/uploads/photos"
UPLOAD_ICONS = "static/uploads/icons"
UPLOAD_VIDEOS = "static/uploads/videos"

# Create folders if not exist
os.makedirs(UPLOAD_PHOTOS, exist_ok=True)
os.makedirs(UPLOAD_ICONS, exist_ok=True)
os.makedirs(UPLOAD_VIDEOS, exist_ok=True)

# ========= Init data file =========
if not os.path.exists(DATA_FILE):
    with open(DATA_FILE, "w") as f:
        json.dump({}, f)

def load_people():
    with open(DATA_FILE, "r") as f:
        return json.load(f)

def save_people(data):
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2)

# ========= HubSpot API =========
HUBSPOT_API_KEY = os.getenv("HUBSPOT_API_KEY")
HEADERS = {
    "Authorization": f"Bearer {HUBSPOT_API_KEY}",
    "Content-Type": "application/json",
    "Accept": "application/json"
}

owners_cache = {}

def load_all_owners():
    url = "https://api.hubapi.com/crm/v3/owners"
    owners = {}
    after = None

    while True:
        params = {"limit": 100}
        if after:
            params["after"] = after

        res = requests.get(url, headers=HEADERS, params=params)
        if res.status_code != 200:
            break

        data = res.json()
        for owner in data.get("results", []):
            owner_id = str(owner["id"])
            name = owner.get("firstName", "") + " " + owner.get("lastName", "")
            owners[owner_id] = name.strip()

        paging = data.get("paging")
        if paging and "next" in paging:
            after = paging["next"]["after"]
        else:
            break

    return owners

@app.before_request
def init_owners():
    global owners_cache
    if not owners_cache:
        owners_cache = load_all_owners()

def get_owner_name(owner_id):
    return owners_cache.get(str(owner_id), "Unknown")

# ========= Routes =========

@app.route('/')
def index():
    return render_template("index.html")

@app.route('/data')
def get_monthly_closed_won_deals():
    CLOSED_WON_STAGE = "2055465198"
    ALLOWED_NAMES = load_people()

    now = datetime.now()
    current_year = now.year
    current_month = now.month

    sales_by_owner = {}
    url = "https://api.hubapi.com/crm/v3/objects/deals"
    params = {
        "properties": "amount,hubspot_owner_id,dealstage,closedate",
        "limit": 100
    }

    while True:
        response = requests.get(url, headers=HEADERS, params=params)
        if response.status_code != 200:
            return jsonify([])

        deals_data = response.json()

        for deal in deals_data.get("results", []):
            props = deal.get("properties", {})
            dealstage = props.get("dealstage")
            closedate = props.get("closedate")
            amount = props.get("amount")
            owner_id = props.get("hubspot_owner_id")

            if not (dealstage and closedate and amount and owner_id):
                continue

            if dealstage != CLOSED_WON_STAGE:
                continue

            try:
                closed_dt = date_parser.parse(closedate)
                if closed_dt.year != current_year or closed_dt.month != current_month:
                    continue
                amount = float(amount)
            except:
                continue

            owner_full_name = get_owner_name(owner_id)

            matched_name = next((key for key in ALLOWED_NAMES if owner_full_name.lower() in key.lower()), None)
            if not matched_name:
                continue

            short_name = ALLOWED_NAMES[matched_name]["short"]
            sales_by_owner[short_name] = sales_by_owner.get(short_name, 0) + amount

        paging = deals_data.get("paging")
        if paging and 'next' in paging:
            params["after"] = paging["next"]["after"]
        else:
            break

    result = [{"Name": name, "Sales": total} for name, total in sales_by_owner.items()]
    result.sort(key=lambda x: x["Sales"], reverse=True)

    return jsonify(result)

@app.route('/goals')
def get_goal_targets():
    # Load manually mapped people
    people = load_people()
    goal_names_set = {p["goal_name"] for p in people.values() if "goal_name" in p}

    url = "https://api.hubapi.com/crm/v3/objects/goal_targets"
    params = {
        "properties": "hs_goal_name,hs_target_amount,hs_start_datetime,hs_end_datetime,hs_created_by_user_id",
        "limit": 100
    }

    all_goals = []
    has_more = True
    after = None

    while has_more:
        if after:
            params["after"] = after

        response = requests.get(url, headers=HEADERS, params=params)
        if response.status_code != 200:
            return jsonify({"error": "Failed to fetch goals"}), response.status_code

        data = response.json()
        goals = data.get("results", [])
        all_goals.extend(goals)

        paging = data.get("paging", {})
        after = paging.get("next", {}).get("after", None)
        has_more = after is not None

    # فقط الجولز اللي معمولة لهم مابينج في الداتا
    result = []
    for goal in all_goals:
        props = goal.get("properties", {})
        goal_name = props.get("hs_goal_name")

        if goal_name in goal_names_set:
            result.append({
                "Goal Name": goal_name,
                "Target": props.get("hs_target_amount"),
                "Start": props.get("hs_start_datetime"),
                "End": props.get("hs_end_datetime"),
                "Created By": get_owner_name(props.get("hs_created_by_user_id"))
            })

    return jsonify(result)


@app.route('/manage', methods=['GET', 'POST'])
def manage_people():
    current_people = load_people()

    # Get all goal names
    goal_response = requests.get("https://api.hubapi.com/crm/v3/objects/goal_targets", headers=HEADERS, params={
        "properties": "hs_goal_name",
        "limit": 100
    })

    goal_names_set = set()
    if goal_response.status_code == 200:
        goals_data = goal_response.json().get("results", [])
        for goal in goals_data:
            name = goal.get("properties", {}).get("hs_goal_name")
            if name:
                goal_names_set.add(name)
    goal_names = sorted(goal_names_set)

    if request.method == "POST":
        full_name = request.form["full_name"]
        short_name = request.form["short_name"].strip()
        file_id_raw = request.form["file_id"].strip().lower()
        file_id = secure_filename(file_id_raw)
        goal_name = request.form["goal_name"].strip()

        photo = request.files.get("photo")
        icon = request.files.get("icon")
        video = request.files.get("video")

        is_update = request.form.get("is_update")

        if is_update and full_name in current_people:
            existing = current_people[full_name]
            old_file_id = existing.get("file_id")

            # ❌ Delete old files if file_id changed
            if old_file_id and old_file_id != file_id:
                for folder, suffix in [
                    (UPLOAD_PHOTOS, ""),
                    (UPLOAD_ICONS, "-icon"),
                    (UPLOAD_VIDEOS, "")
                ]:
                    for ext in [".png", ".jpg", ".jpeg", ".webp", ".mp4"]:
                        old_path = os.path.join(folder, f"{old_file_id}{suffix}{ext}")
                        if os.path.exists(old_path):
                            os.remove(old_path)

            person_data = {
                "short": short_name,
                "file_id": file_id,
                "goal_name": goal_name,
                "photo": existing.get("photo", f"{file_id}.png"),
                "icon": existing.get("icon", f"{file_id}-icon.png"),
                "video": existing.get("video", f"{file_id}.mp4")
            }

            # ✅ Save new files (if uploaded)
            if photo and photo.filename:
                photo_path = os.path.join(UPLOAD_PHOTOS, f"{file_id}.png")
                photo.save(photo_path)
                person_data["photo"] = os.path.basename(photo_path)

            if icon and icon.filename:
                icon_path = os.path.join(UPLOAD_ICONS, f"{file_id}-icon.png")
                icon.save(icon_path)
                person_data["icon"] = os.path.basename(icon_path)

            if video and video.filename:
                video_path = os.path.join(UPLOAD_VIDEOS, f"{file_id}.mp4")
                video.save(video_path)
                person_data["video"] = os.path.basename(video_path)

            current_people[full_name] = person_data
            save_people(current_people)
            return redirect(url_for("manage_people"))

        else:
            # ✅ New entry: All files are required
            if not (photo and icon and video):
                return "Missing file uploads for new person", 400

            photo_filename = f"{file_id}.png"
            icon_filename = f"{file_id}-icon.png"
            video_filename = f"{file_id}.mp4"

            photo.save(os.path.join(UPLOAD_PHOTOS, photo_filename))
            icon.save(os.path.join(UPLOAD_ICONS, icon_filename))
            video.save(os.path.join(UPLOAD_VIDEOS, video_filename))

            person_data = {
                "short": short_name,
                "file_id": file_id,
                "goal_name": goal_name,
                "photo": photo_filename,
                "icon": icon_filename,
                "video": video_filename
            }

            current_people[full_name] = person_data
            save_people(current_people)
            return redirect(url_for("manage_people"))

    hubspot_names = sorted(set(owners_cache.values()))
    return render_template("manage.html", people=current_people, hubspot_names=hubspot_names, goal_names=goal_names)


@app.route("/delete/<name>")
def delete_person(name):
    people = load_people()
    if name in people:
        person = people[name]
        file_id = person.get("file_id")

        if file_id:
            for folder, suffix in [
                (UPLOAD_PHOTOS, ""),
                (UPLOAD_ICONS, "-icon"),
                (UPLOAD_VIDEOS, "")
            ]:
                for ext in [".png", ".jpg", ".jpeg", ".webp", ".mp4"]:
                    file_path = os.path.join(folder, f"{file_id}{suffix}{ext}")
                    if os.path.exists(file_path):
                        os.remove(file_path)

        del people[name]
        save_people(people)

    return redirect(url_for("manage_people"))

@app.route('/update/<name>', methods=['POST'])
def update_person(name):
    people = load_people()
    if name not in people:
        return "Person not found", 404

    short_name = request.form["short_name"].strip()
    file_id_raw = request.form["file_id"].strip().lower()
    file_id = secure_filename(file_id_raw)
    goal_name = request.form["goal_name"].strip()

    photo = request.files.get("photo")
    icon = request.files.get("icon")
    video = request.files.get("video")

    if photo and photo.filename:
        photo.save(os.path.join(UPLOAD_PHOTOS, f"{file_id}.png"))
    if icon and icon.filename:
        icon.save(os.path.join(UPLOAD_ICONS, f"{file_id}-icon.png"))
    if video and video.filename:
        video.save(os.path.join(UPLOAD_VIDEOS, f"{file_id}.mp4"))

    people[name] = {
        "short": short_name,
        "file_id": file_id,
        "goal_name": goal_name,
        "photo": f"{file_id}.png",
        "icon": f"{file_id}-icon.png",
        "video": f"{file_id}.mp4"
    }

    save_people(people)
    return redirect(url_for("manage_people"))

@app.route("/people")
def people_metadata():
    return jsonify(load_people())

if __name__ == '__main__':
    app.run(debug=True)
    app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024