/* =========================================================
   CAMPUSVOICE JAVASCRIPT
========================================================= */


/* =========================================================
   GLOBAL VARIABLES
========================================================= */

let currentUser = null;

let selectedRating = 0;

let currentPhoto = "";

let allReviews = [];


/* =========================================================
   ELEMENTS
========================================================= */

const landingPage =
    document.getElementById("landingPage");

const authPage =
    document.getElementById("authPage");

const mainPage =
    document.getElementById("mainPage");


/* =========================================================
   AUTH NAVIGATION
========================================================= */

function showLogin() {

    hideGuestPage();

    landingPage.style.display = "none";

    authPage.style.display = "flex";

    mainPage.style.display = "none";


    document
        .getElementById("loginForm")
        .classList.remove("hidden");


    document
        .getElementById("signupForm")
        .classList.add("hidden");
}


function showSignup() {

    hideGuestPage();

    landingPage.style.display = "none";

    authPage.style.display = "flex";

    mainPage.style.display = "none";


    document
        .getElementById("loginForm")
        .classList.add("hidden");


    document
        .getElementById("signupForm")
        .classList.remove("hidden");
}


function backHome() {

    hideGuestPage();

    landingPage.style.display = "flex";

    authPage.style.display = "none";

    mainPage.style.display = "none";
}


/* =========================================================
   API HELPER
========================================================= */

/*
   All data lives on the Flask server (campusvoice.db).
   api(path) reads; api(path, body) sends JSON.
*/

async function api(path, body) {

    const options = {

        method:
            body === undefined
                ? "GET"
                : "POST",

        headers: {},

        credentials: "same-origin"

    };


    if (body !== undefined) {

        options.headers["Content-Type"] =
            "application/json";

        options.body =
            JSON.stringify(body);
    }


    let response;

    try {

        response =
            await fetch(path, options);

    } catch (networkError) {

        throw new Error(
            "Can't reach the server. Is it running?"
        );
    }


    const data =
        await response.json().catch(() => ({}));


    if (!response.ok) {

        throw new Error(
            data.error || "Something went wrong."
        );
    }


    return data;
}


/* =========================================================
   SIGN UP
========================================================= */

async function signupUser() {

    const username =
        document
            .getElementById("signupUsername")
            .value
            .trim();


    const studentNumber =
        document
            .getElementById("signupStudentNumber")
            .value
            .trim();


    const password =
        document
            .getElementById("signupPassword")
            .value;


    const confirm =
        document
            .getElementById("signupConfirm")
            .value;


    if (
        username === "" ||
        studentNumber === "" ||
        password === "" ||
        confirm === ""
    ) {

        alert(
            "Please complete all fields."
        );

        return;
    }


    if (!/^[0-9]{2}-[0-9]{4}-[0-9]{3}$/.test(studentNumber)) {

        alert(
            "Student number must look like 21-0123-456."
        );

        return;
    }


    if (username.length < 3) {

        alert(
            "Username must contain at least 3 characters."
        );

        return;
    }


    if (password.length < 6) {

        alert(
            "Password must contain at least 6 characters."
        );

        return;
    }


    if (password !== confirm) {

        alert(
            "Passwords do not match."
        );

        return;
    }


    try {

        await api(
            "/api/signup",
            {
                username: username,
                student_number: studentNumber,
                password: password
            }
        );

    } catch (failure) {

        alert(failure.message);

        return;
    }


    alert(
        "Account created successfully!"
    );


    document.getElementById(
        "signupUsername"
    ).value = "";


    document.getElementById(
        "signupStudentNumber"
    ).value = "";


    document.getElementById(
        "signupPassword"
    ).value = "";


    document.getElementById(
        "signupConfirm"
    ).value = "";


    showLogin();


    document.getElementById(
        "loginUsername"
    ).value = username;
}


/* =========================================================
   LOGIN
========================================================= */

async function loginUser() {

    const username =
        document
            .getElementById("loginUsername")
            .value
            .trim();


    const password =
        document
            .getElementById("loginPassword")
            .value;


    if (
        username === "" ||
        password === ""
    ) {

        alert(
            "Please enter your username and password."
        );

        return;
    }


    try {

        const data = await api(
            "/api/login",
            {
                username: username,
                password: password
            }
        );

        currentUser = data.user;

    } catch (failure) {

        alert(failure.message);

        return;
    }


    openMainPage();
}


/* =========================================================
   OPEN MAIN PAGE
========================================================= */

function openMainPage() {

    hideGuestPage();

    landingPage.style.display = "none";

    authPage.style.display = "none";

    mainPage.style.display = "block";

    document.getElementById("adminPage").style.display = "none";

    document
        .getElementById("adminBtn")
        .classList.toggle("hidden", !currentUser.is_admin);


    document.getElementById(
        "currentUser"
    ).textContent =
        "👤 " + currentUser.username;


    loadReviews();
}


/* =========================================================
   LOGOUT
========================================================= */

async function logout() {

    try {

        await api("/api/logout", {});

    } catch (failure) {

        // Already logged out on the server; carry on
    }


    currentUser = null;

    allReviews = [];


    hideGuestPage();

    mainPage.style.display = "none";

    landingPage.style.display = "flex";


    document.getElementById(
        "loginUsername"
    ).value = "";


    document.getElementById(
        "loginPassword"
    ).value = "";
}


/* =========================================================
   STAR RATING
========================================================= */

function selectStar(number) {

    selectedRating = number;


    document
        .querySelectorAll(".star")
        .forEach(
            (star, index) => {

                if (index < number) {

                    star.classList.add(
                        "active"
                    );

                } else {

                    star.classList.remove(
                        "active"
                    );

                }

            }
        );
}


/* =========================================================
   PHOTO PREVIEW
========================================================= */

function previewPhoto(event) {

    const file =
        event.target.files[0];


    if (!file) {

        return;
    }


    if (
        !file.type.startsWith("image/")
    ) {

        alert(
            "Please select an image file."
        );

        return;
    }


    /*
       Limit very large images because
       localStorage has limited capacity.
    */

    if (
        file.size > 2 * 1024 * 1024
    ) {

        alert(
            "Please choose an image smaller than 2MB."
        );

        event.target.value = "";

        return;
    }


    const reader =
        new FileReader();


    reader.onload =
        function(e) {

            currentPhoto =
                e.target.result;


            const preview =
                document.getElementById(
                    "imagePreview"
                );


            preview.src =
                currentPhoto;


            preview.style.display =
                "block";
        };


    reader.readAsDataURL(file);
}


/* =========================================================
   POST REVIEW
========================================================= */

async function postReview() {

    if (!currentUser) {

        alert(
            "Please log in first."
        );

        return;
    }


    const category =
        document.getElementById(
            "reviewCategory"
        ).value;


    const text =
        document.getElementById(
            "reviewInput"
        ).value.trim();


    if (selectedRating === 0) {

        alert(
            "Please select a rating from 1 to 5 stars."
        );

        return;
    }


    if (text === "") {

        alert(
            "Please write your feedback."
        );

        return;
    }


    try {

        await api(
            "/api/reviews",
            {
                category: category,
                rating: selectedRating,
                text: text,
                image: currentPhoto
            }
        );

    } catch (failure) {

        alert(failure.message);

        return;
    }


    /*
       Reset form
    */

    document.getElementById(
        "reviewInput"
    ).value = "";


    document.getElementById(
        "photoInput"
    ).value = "";


    document.getElementById(
        "imagePreview"
    ).style.display = "none";


    selectedRating = 0;

    currentPhoto = "";


    document
        .querySelectorAll(".star")
        .forEach(
            star =>
                star.classList.remove(
                    "active"
                )
        );


    await loadReviews();


    alert(
        "Your feedback has been submitted."
    );


    window.scrollTo({
        top: document
            .querySelector(".review-toolbar")
            .offsetTop - 90,

        behavior: "smooth"
    });
}


/* =========================================================
   LOAD REVIEWS
========================================================= */

async function loadReviews() {

    try {

        const data =
            await api("/api/reviews");

        allReviews = data.reviews;

    } catch (failure) {

        alert(failure.message);

        return;
    }


    renderReviews();
}


function renderReviews() {

    const container =
        document.getElementById(
            "reviewsContainer"
        );


    container.innerHTML = "";


    let reviews = allReviews;


    const search =
        document.getElementById(
            "searchInput"
        )?.value
        .toLowerCase()
        .trim()
        || "";


    if (search !== "") {

        reviews =
            reviews.filter(
                review =>

                    review.text
                        .toLowerCase()
                        .includes(search)

                    ||

                    review.username
                        .toLowerCase()
                        .includes(search)

                    ||

                    review.category
                        .toLowerCase()
                        .includes(search)
            );
    }


    if (reviews.length === 0) {

        container.innerHTML = `

            <div class="empty-state">

                <h3>No feedback found</h3>

                <p>
                    Try another search term or
                    be the first to share feedback.
                </p>

            </div>

        `;


    } else {

        reviews.forEach(
            review =>
                renderReview(
                    review,
                    container
                )
        );
    }


    updateStatistics();
}


/* =========================================================
   RENDER REVIEW
========================================================= */

function formatDate(value) {

    return new Date(value).toLocaleDateString(
        "en-US",
        {
            year: "numeric",
            month: "long",
            day: "numeric"
        }
    );
}


function renderReview(
    review,
    container
) {

    const element =
        document.createElement("article");


    element.className =
        "review-card";


    const initials =
        review.username
            .substring(0, 2)
            .toUpperCase();


    const stars =
        "★".repeat(review.rating)
        +
        "☆".repeat(
            5 - review.rating
        );


    // The server only accepts image data URLs
    let imageHTML = "";


    if (review.image) {

        imageHTML = `

            <img
                class="review-image"
                src="${review.image}"
                alt="Student feedback photo">

        `;
    }


    let repliesHTML = "";


    if (review.replies.length > 0) {

        repliesHTML = `

            <div class="replies">

                ${
                    review.replies
                        .map(
                            reply => `

                            <div class="reply">

                                <strong>

                                    ${escapeHTML(
                                        reply.username
                                    )}

                                </strong>

                                <div>

                                    ${escapeHTML(
                                        reply.text
                                    )}

                                </div>

                            </div>

                        `
                        )
                        .join("")
                }

            </div>

        `;
    }


    /*
       review.likes is the real number of likes (from the database).
       review.liked_by is the list of usernames who liked this post.
       TODO (team): show the names from review.liked_by here.
    */

    element.innerHTML = `

        <div class="review-top">

            <div class="profile">

                <div class="avatar">

                    ${escapeHTML(initials)}

                </div>


                <div>

                    <div class="username">

                        ${escapeHTML(
                            review.username
                        )}

                    </div>


                    <div class="review-date">

                        ${formatDate(review.date)}

                    </div>

                </div>

            </div>


            <span class="category-tag">

                ${escapeHTML(
                    review.category
                )}

            </span>

        </div>


        <div class="review-stars">

            ${stars}

        </div>


        <div class="review-text">

            ${escapeHTML(
                review.text
            )}

        </div>


        ${imageHTML}


        <div class="review-actions">

            <button
                class="review-action${
                    review.my_reaction === "like"
                        ? " reacted"
                        : ""
                }"
                onclick="likeReview(${review.id})">

                👍 ${
                    review.my_reaction === "like"
                        ? "Unlike"
                        : "Like"
                } ${review.likes}

            </button>


            <button
                class="review-action${
                    review.my_reaction === "dislike"
                        ? " reacted"
                        : ""
                }"
                onclick="dislikeReview(${review.id})">

                👎 Dislike ${review.dislikes}

            </button>


            <button
                class="review-action"
                onclick="toggleReply(${review.id})">

                💬 Reply

            </button>


            <button
                class="review-action report-action"
                onclick="reportReview(${review.id})">

                ⚠ Report

            </button>

        </div>


        <div
            class="reply-box"
            id="reply-${review.id}">

            <textarea
                id="replyText-${review.id}"
                placeholder="Write a reply to this feedback..."></textarea>


            <button
                class="reply-send"
                onclick="sendReply(${review.id})">

                Send Reply

            </button>

        </div>


        ${repliesHTML}

    `;


    container.appendChild(element);
}


/* =========================================================
   LIKE
========================================================= */

function likeReview(id) {

    reactToReview(
        id,
        "like"
    );
}


/* =========================================================
   DISLIKE
========================================================= */

function dislikeReview(id) {

    reactToReview(
        id,
        "dislike"
    );
}


/* =========================================================
   REACTION HELPER
========================================================= */

/*
   The server adds, switches or removes the reaction and
   guarantees one reaction per user per post.
*/

async function reactToReview(
    id,
    kind
) {

    try {

        await api(
            "/api/reviews/" + id + "/react",
            { kind: kind }
        );

    } catch (failure) {

        alert(failure.message);

        return;
    }


    loadReviews();
}


/* =========================================================
   REPLY TOGGLE
========================================================= */

function toggleReply(id) {

    const box =
        document.getElementById(
            "reply-" + id
        );


    if (!box) {

        return;
    }


    box.style.display =
        box.style.display === "block"
            ? "none"
            : "block";
}


/* =========================================================
   SEND REPLY
========================================================= */

async function sendReply(id) {

    if (!currentUser) {

        alert(
            "Please log in first."
        );

        return;
    }


    const input =
        document.getElementById(
            "replyText-" + id
        );


    const text =
        input.value.trim();


    if (text === "") {

        alert(
            "Please write a reply."
        );

        return;
    }


    try {

        await api(
            "/api/reviews/" + id + "/reply",
            { text: text }
        );

    } catch (failure) {

        alert(failure.message);

        return;
    }


    await loadReviews();


    alert(
        "Your reply has been posted."
    );
}


/* =========================================================
   REPORT
========================================================= */

async function reportReview(id) {

    if (!currentUser) {

        alert(
            "Please log in first."
        );

        return;
    }


    const reason =
        prompt(
            "Please enter the reason for reporting this feedback:"
        );


    if (
        !reason ||
        reason.trim() === ""
    ) {

        return;
    }


    try {

        await api(
            "/api/reviews/" + id + "/report",
            { reason: reason.trim() }
        );

    } catch (failure) {

        alert(failure.message);

        return;
    }


    alert(
        "Thank you. Your report has been recorded."
    );
}


/* =========================================================
   STATISTICS
========================================================= */

function updateStatistics() {

    const total =
        allReviews.length;


    let ratingTotal = 0;

    let replyTotal = 0;


    allReviews.forEach(
        review => {

            ratingTotal += review.rating;

            replyTotal += review.replies.length;
        }
    );


    const average =
        total === 0
            ? 0
            : ratingTotal / total;


    document.getElementById(
        "overallRating"
    ).textContent =
        average.toFixed(1)
        + " / 5";


    document.getElementById(
        "totalReviews"
    ).textContent =
        total;


    document.getElementById(
        "totalReplies"
    ).textContent =
        replyTotal;
}


/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHTML(value) {

    const div =
        document.createElement("div");


    div.textContent =
        value;


    return div.innerHTML;
}


/* =========================================================
   GUEST FEEDBACK
   Guests are not department members. This flow only saves
   a complaint/feedback. It never touches currentUser or
   "campusVoiceCurrentUser", so it can't open the platform.
========================================================= */

const guestPage =
    document.getElementById("guestPage");

const GUEST_STORAGE_KEY =
    "campusVoiceGuestFeedback";

const GUEST_LAST_SUBMIT_KEY =
    "campusVoiceGuestLastSubmit";

const GUEST_MESSAGE_MAX = 2000;

// Only these roles are accepted (the server checks again)
const GUEST_ROLES = ["Student", "Faculty", "Staff", "Guest"];


// "Guest" alone stays "Guest"; the others read "Guest (Student)", etc.
function guestRoleLabel(role) {

    return role === "Guest"
        ? "Guest"
        : "Guest (" + role + ")";
}


// The role the guest picked in step 1
let guestSelectedRole = "";


// Step 1 -> Step 2: role chosen, show the feedback form
function chooseGuestRole(role) {

    if (!GUEST_ROLES.includes(role)) {

        return;
    }

    guestSelectedRole = role;

    document.getElementById("guestRoleBadge").textContent =
        guestRoleLabel(role);

    setGuestError("guestRole", "");

    document
        .getElementById("guestRoleStep")
        .classList.add("hidden");

    document
        .getElementById("guestForm")
        .classList.remove("hidden");

    window.scrollTo(0, 0);
}


// Back to step 1 so the guest can change their role
function showGuestRoleStep() {

    document
        .getElementById("guestForm")
        .classList.add("hidden");

    document
        .getElementById("guestRoleStep")
        .classList.remove("hidden");
}


// Make sure only the guest page is visible
function hideGuestPage() {

    const page =
        document.getElementById("guestPage");

    if (page) {

        page.style.display = "none";
    }
}

const GUEST_COOLDOWN_MS = 30 * 1000;


const GUEST_CONTACT_TYPES = {

    email: {
        inputType: "email",
        inputMode: "email",
        maxLength: 254,
        placeholder: "e.g. juan@example.com"
    },

    mobile: {
        inputType: "tel",
        inputMode: "tel",
        maxLength: 16,
        placeholder: "e.g. 09171234567 or +639171234567"
    },

    facebook: {
        inputType: "text",
        inputMode: "text",
        maxLength: 200,
        placeholder: "Facebook profile link or name"
    }

};


function showGuest() {

    landingPage.style.display = "none";

    authPage.style.display = "none";

    mainPage.style.display = "none";

    guestPage.style.display = "flex";


    resetGuestForm();


    window.scrollTo(0, 0);
}


function guestBackToLogin() {

    guestPage.style.display = "none";


    resetGuestForm();


    showLogin();
}


function resetGuestForm() {

    document
        .getElementById("guestForm")
        .reset();


    // Always start at step 1 (choose a role)
    guestSelectedRole = "";

    document
        .getElementById("guestForm")
        .classList.add("hidden");


    document
        .getElementById("guestRoleStep")
        .classList.remove("hidden");


    document
        .getElementById("guestThanks")
        .classList.add("hidden");


    clearGuestErrors();

    updateGuestContactInput();

    updateGuestCounter();
}


function getGuestContactType() {

    const checked =
        document.querySelector(
            'input[name="guestContactType"]:checked'
        );


    return checked
        ? checked.value
        : "";
}


function updateGuestContactInput() {

    const type =
        getGuestContactType();


    const config =
        GUEST_CONTACT_TYPES[type];


    if (!config) {

        return;
    }


    const input =
        document.getElementById("guestContact");


    input.type = config.inputType;

    input.inputMode = config.inputMode;

    input.maxLength = config.maxLength;

    input.placeholder = config.placeholder;

    input.value = "";


    setGuestError(
        "guestContact",
        ""
    );
}


function updateGuestCounter() {

    const length =
        document
            .getElementById("guestMessage")
            .value
            .length;


    document.getElementById(
        "guestCounter"
    ).textContent =
        length + " / " + GUEST_MESSAGE_MAX;
}


function setGuestError(
    fieldId,
    message
) {

    const error =
        document.getElementById(
            fieldId + "Error"
        );


    const field =
        document.getElementById(fieldId);


    // textContent keeps any user text from being parsed as HTML
    error.textContent = message;


    if (
        field &&
        fieldId !== "guestForm"
    ) {

        field.classList.toggle(
            "guest-invalid",
            message !== ""
        );


        field.setAttribute(
            "aria-invalid",
            message !== ""
        );
    }
}


function clearGuestErrors() {

    setGuestError("guestRole", "");

    setGuestError("guestMessage", "");

    setGuestError("guestContact", "");

    setGuestError("guestForm", "");
}


/*
   Returns { value, error }. value is the cleaned
   contact detail that gets saved.
*/

function validateGuestContact(
    type,
    raw
) {

    const value =
        raw.trim();


    if (value === "") {

        return {
            value: "",
            error: "Please enter how we can contact you."
        };
    }


    if (type === "email") {

        const emailPattern =
            /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;


        if (
            value.length > 254 ||
            !emailPattern.test(value)
        ) {

            return {
                value: "",
                error: "Please enter a valid email address."
            };
        }


        return {
            value: value.toLowerCase(),
            error: ""
        };
    }


    if (type === "mobile") {

        // Allow spaces and dashes while typing, then strip them
        const mobile =
            value.replace(/[\s-]/g, "");


        if (
            !/^(09\d{9}|\+639\d{9})$/.test(mobile)
        ) {

            return {
                value: "",
                error: "Please enter a valid PH mobile number (09XXXXXXXXX or +639XXXXXXXXX)."
            };
        }


        return {
            value: mobile,
            error: ""
        };
    }


    if (type === "facebook") {

        const linkPattern =
            /^(https?:\/\/)?(www\.|m\.|web\.)?(facebook\.com|fb\.com)\/[A-Za-z0-9.\-_/?=&%]+$/i;


        const namePattern =
            /^[\p{L}][\p{L} .'-]{1,99}$/u;


        if (
            value.length > 200 ||
            (
                !linkPattern.test(value) &&
                !namePattern.test(value)
            )
        ) {

            return {
                value: "",
                error: "Please enter a Facebook profile link (facebook.com/...) or your Facebook name."
            };
        }


        return {
            value: value,
            error: ""
        };
    }


    return {
        value: "",
        error: "Please choose a contact type."
    };
}


async function submitGuestFeedback(event) {

    event.preventDefault();

    clearGuestErrors();

    const selectedRole =
        guestSelectedRole;


    /*
       Honeypot: people never see this field.
       If it's filled, act like it worked but save nothing.
    */

    const honeypot =
        document
            .getElementById("guestWebsite")
            .value;


    if (honeypot !== "") {

        showGuestThanks();

        return;
    }


    const message =
        document
            .getElementById("guestMessage")
            .value
            .trim();


    const contactType =
        getGuestContactType();


    const contact =
        validateGuestContact(
            contactType,
            document
                .getElementById("guestContact")
                .value
        );


    let valid = true;


    if (!GUEST_ROLES.includes(selectedRole)) {

        setGuestError(
            "guestRole",
            "Please choose your role first (Student, Faculty, Staff, or Guest)."
        );

        valid = false;
    }


    if (message === "") {

        setGuestError(
            "guestMessage",
            "Please write your complaint or feedback."
        );

        valid = false;

    } else if (message.length < 10) {

        setGuestError(
            "guestMessage",
            "Please add a bit more detail (at least 10 characters)."
        );

        valid = false;

    } else if (message.length > GUEST_MESSAGE_MAX) {

        setGuestError(
            "guestMessage",
            "Please keep it under " + GUEST_MESSAGE_MAX + " characters."
        );

        valid = false;
    }


    if (contact.error !== "") {

        setGuestError(
            "guestContact",
            contact.error
        );

        valid = false;
    }


    if (!valid) {

        const firstInvalid =
            document.querySelector(
                "#guestForm .guest-invalid"
            );


        if (firstInvalid) {

            firstInvalid.focus();
        }

        return;
    }


    /*
       Simple spam protection: one submission
       every 30 seconds from this browser.
    */

    const lastSubmit =
        Number(
            localStorage.getItem(
                GUEST_LAST_SUBMIT_KEY
            )
        ) || 0;


    if (
        Date.now() - lastSubmit
        < GUEST_COOLDOWN_MS
    ) {

        setGuestError(
            "guestForm",
            "You just sent a concern. Please wait a moment before sending another."
        );

        return;
    }


     // Send to the server instead of saving in the browser
    try {

        await api(
    "/api/guest-feedback",
    {
        role: selectedRole,
        message: message,
        contact_type: contactType,
        contact_value: contact.value
    }
);

    } catch (failure) {

        setGuestError("guestForm", failure.message);

        return;
    }


    localStorage.setItem(
        GUEST_LAST_SUBMIT_KEY,
        String(Date.now())
    );


    showGuestThanks(selectedRole);
}


function showGuestThanks(role) {

    const thanksRole =
        document.getElementById("guestThanksRole");

    thanksRole.textContent =
        GUEST_ROLES.includes(role)
            ? "Submitted as: " + guestRoleLabel(role)
            : "";


    document
        .getElementById("guestForm")
        .classList.add("hidden");


    document
        .getElementById("guestThanks")
        .classList.remove("hidden");
}


/* =========================================================
   INITIALIZE
========================================================= */

window.addEventListener(
    "load",
    async function() {

        // The guest page only opens from the Guest button
        hideGuestPage();

        // Ask the server whether this browser is logged in
        try {

            const data =
                await api("/api/me");


            currentUser =
                data.user;


            openMainPage();

        } catch (failure) {

            landingPage.style.display =
                "flex";

            authPage.style.display =
                "none";

            mainPage.style.display =
                "none";
        }

    }
);

/* =========================================================
   ADMIN WORKLOAD TRACKING
========================================================= */

const adminPage =
    document.getElementById("adminPage");

let adminData = null;


async function showAdmin() {

    mainPage.style.display = "none";

    adminPage.style.display = "block";

    window.scrollTo(0, 0);

    await loadAdmin();
}


function hideAdmin() {

    adminPage.style.display = "none";

    mainPage.style.display = "block";
}


async function loadAdmin() {

    try {

        adminData = await api("/api/admin/workload");

    } catch (failure) {

        alert(failure.message);

        return;
    }

    renderAdmin();
}


function renderAdmin() {

    if (!adminData) {
        return;
    }

    document.getElementById("adminPending").textContent =
        adminData.counts.pending;

    document.getElementById("adminCompleted").textContent =
        adminData.counts.completed;

    document.getElementById("adminTotal").textContent =
        adminData.counts.total;

    const filter =
        document.getElementById("adminFilter").value;

    const keep =
        item => filter === "all" || item.status === filter;

    renderAdminList(
        "adminPosts",
        adminData.posts.filter(keep),
        "posts"
    );

    renderAdminList(
        "adminGuests",
        adminData.guests.filter(keep),
        "guests"
    );
}


function renderAdminList(containerId, items, kind) {

    const container =
        document.getElementById(containerId);

    if (items.length === 0) {

        container.innerHTML = `
            <div class="empty-state">
                <p>Nothing here.</p>
            </div>
        `;

        return;
    }

    container.innerHTML = items.map(item => {

        const done = item.status === "completed";

        const title =
            kind === "posts"
                ? escapeHTML(item.username) + " · " +
                  escapeHTML(item.category) + " · " +
                  "★".repeat(item.rating)
                : escapeHTML(guestRoleLabel(item.role || "Not specified")) + " · " +
  escapeHTML(item.contact_type) +
  ": " + escapeHTML(item.contact_value);

        const body =
            kind === "posts"
                ? item.text
                : item.message;

        return `

            <article class="admin-item">

                <div class="admin-item-top">

                    <strong>${title}</strong>

                    <span class="status-badge ${done ? "completed" : "pending"}">
                        ${done ? "Completed" : "Pending"}
                    </span>

                </div>

                <div class="review-date">${formatDate(item.date)}</div>

                <div class="review-text">${escapeHTML(body)}</div>

                <button
                    class="review-action"
                    onclick="setAdminStatus('${kind}', ${item.id}, '${done ? "pending" : "completed"}')">

                    ${done ? "↩ Mark as Pending" : "✓ Mark as Completed"}

                </button>

            </article>

        `;

    }).join("");
}


async function setAdminStatus(kind, id, status) {

    try {

        await api(
            "/api/admin/" + kind + "/" + id + "/status",
            { status: status }
        );

    } catch (failure) {

        alert(failure.message);

        return;
    }

    await loadAdmin();
}
