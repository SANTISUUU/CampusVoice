/* =========================================================
   CAMPUSVOICE JAVASCRIPT
========================================================= */


/* =========================================================
   GLOBAL VARIABLES
========================================================= */

let currentUser = null;

let selectedRating = 0;

let currentPhoto = "";


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

    landingPage.style.display = "flex";

    authPage.style.display = "none";

    mainPage.style.display = "none";
}


/* =========================================================
   SIGN UP
========================================================= */

function signupUser() {

    const username =
        document
            .getElementById("signupUsername")
            .value
            .trim();


    const email =
        document
            .getElementById("signupEmail")
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
        email === "" ||
        password === "" ||
        confirm === ""
    ) {

        alert(
            "Please complete all fields."
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


    let users =
        JSON.parse(
            localStorage.getItem(
                "campusVoiceUsers"
            )
        ) || [];


    const exists =
        users.some(
            user =>
                user.username.toLowerCase()
                === username.toLowerCase()
        );


    if (exists) {

        alert(
            "That username is already registered."
        );

        return;
    }


    users.push({

        username: username,

        email: email,

        password: password

    });


    localStorage.setItem(
        "campusVoiceUsers",
        JSON.stringify(users)
    );


    alert(
        "Account created successfully!"
    );


    document.getElementById(
        "signupUsername"
    ).value = "";


    document.getElementById(
        "signupEmail"
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

function loginUser() {

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


    const users =
        JSON.parse(
            localStorage.getItem(
                "campusVoiceUsers"
            )
        ) || [];


    const user =
        users.find(
            account =>
                account.username.toLowerCase()
                === username.toLowerCase()
                &&
                account.password === password
        );


    if (!user) {

        alert(
            "Incorrect username or password."
        );

        return;
    }


    currentUser = user;


    localStorage.setItem(
        "campusVoiceCurrentUser",
        JSON.stringify(user)
    );


    openMainPage();
}


/* =========================================================
   OPEN MAIN PAGE
========================================================= */

function openMainPage() {

    landingPage.style.display = "none";

    authPage.style.display = "none";

    mainPage.style.display = "block";


    document.getElementById(
        "currentUser"
    ).textContent =
        "👤 " + currentUser.username;


    loadReviews();
}


/* =========================================================
   LOGOUT
========================================================= */

function logout() {

    localStorage.removeItem(
        "campusVoiceCurrentUser"
    );


    currentUser = null;


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

function postReview() {

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


    let reviews =
        JSON.parse(
            localStorage.getItem(
                "campusVoiceReviews"
            )
        ) || [];


    const review = {

        id: Date.now(),

        username:
            currentUser.username,

        category:
            category,

        rating:
            selectedRating,

        text:
            text,

        image:
            currentPhoto,

        date:
            new Date().toLocaleDateString(
                "en-US",
                {
                    year: "numeric",
                    month: "long",
                    day: "numeric"
                }
            ),

        likes: 0,

        dislikes: 0,

        replies: [],

        reports: []

    };


    reviews.unshift(review);


    localStorage.setItem(
        "campusVoiceReviews",
        JSON.stringify(reviews)
    );


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


    loadReviews();


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
   SAMPLE REVIEWS
========================================================= */

function createSampleReviews() {

    const existing =
        localStorage.getItem(
            "campusVoiceReviews"
        );


    if (existing) {

        return;
    }


    const samples = [

        {

            id: 1001,

            username:
                "Juan Dela Cruz",

            category:
                "Quality & Condition",

            rating: 5,

            text:
                "The computer laboratory was clean and the computers were working properly during our activity. The equipment made it easier to complete our programming tasks.",

            image: "",

            date:
                "September 20, 2026",

            likes: 12,

            dislikes: 1,

            replies: [],

            reports: []

        },


        {

            id: 1002,

            username:
                "Maria Santos",

            category:
                "Information Accessibility",

            rating: 4,

            text:
                "Information about our laboratory schedule was available, but sometimes announcements could be posted earlier so students have more time to prepare.",

            image: "",

            date:
                "September 18, 2026",

            likes: 8,

            dislikes: 2,

            replies: [],

            reports: []

        },


        {

            id: 1003,

            username:
                "Alex Reyes",

            category:
                "Responsiveness",

            rating: 4,

            text:
                "When we encountered a problem with one of the computers, our concern was addressed. More consistent response times would make the experience better.",

            image: "",

            date:
                "September 15, 2026",

            likes: 6,

            dislikes: 1,

            replies: [],

            reports: []

        }

    ];


    localStorage.setItem(
        "campusVoiceReviews",
        JSON.stringify(samples)
    );
}


/* =========================================================
   LOAD REVIEWS
========================================================= */

function loadReviews() {

    createSampleReviews();


    const container =
        document.getElementById(
            "reviewsContainer"
        );


    container.innerHTML = "";


    let reviews =
        JSON.parse(
            localStorage.getItem(
                "campusVoiceReviews"
            )
        ) || [];


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


    if (
        review.replies &&
        review.replies.length > 0
    ) {

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


    element.innerHTML = `

        <div class="review-top">

            <div class="profile">

                <div class="avatar">

                    ${initials}

                </div>


                <div>

                    <div class="username">

                        ${escapeHTML(
                            review.username
                        )}

                    </div>


                    <div class="review-date">

                        ${review.date}

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
                class="review-action"
                onclick="likeReview(${review.id})">

                👍 Like ${review.likes}

            </button>


            <button
                class="review-action"
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
                placeholder="Write a reply to this feedback...">
            </textarea>


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

    modifyReviewReaction(
        id,
        "likes"
    );
}


/* =========================================================
   DISLIKE
========================================================= */

function dislikeReview(id) {

    modifyReviewReaction(
        id,
        "dislikes"
    );
}


/* =========================================================
   REACTION HELPER
========================================================= */

function modifyReviewReaction(
    id,
    property
) {

    let reviews =
        JSON.parse(
            localStorage.getItem(
                "campusVoiceReviews"
            )
        ) || [];


    const review =
        reviews.find(
            item =>
                item.id === id
        );


    if (!review) {

        return;
    }


    review[property]++;


    localStorage.setItem(
        "campusVoiceReviews",
        JSON.stringify(reviews)
    );


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

function sendReply(id) {

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


    let reviews =
        JSON.parse(
            localStorage.getItem(
                "campusVoiceReviews"
            )
        ) || [];


    const review =
        reviews.find(
            item =>
                item.id === id
        );


    if (!review) {

        return;
    }


    if (!review.replies) {

        review.replies = [];
    }


    review.replies.push({

        username:
            currentUser.username,

        text:
            text,

        date:
            new Date().toLocaleDateString()

    });


    localStorage.setItem(
        "campusVoiceReviews",
        JSON.stringify(reviews)
    );


    loadReviews();


    alert(
        "Your reply has been posted."
    );
}


/* =========================================================
   REPORT
========================================================= */

function reportReview(id) {

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


    let reviews =
        JSON.parse(
            localStorage.getItem(
                "campusVoiceReviews"
            )
        ) || [];


    const review =
        reviews.find(
            item =>
                item.id === id
        );


    if (!review) {

        return;
    }


    if (!review.reports) {

        review.reports = [];
    }


    review.reports.push({

        username:
            currentUser.username,

        reason:
            reason.trim(),

        date:
            new Date().toLocaleString()

    });


    localStorage.setItem(
        "campusVoiceReviews",
        JSON.stringify(reviews)
    );


    alert(
        "Thank you. Your report has been recorded."
    );
}


/* =========================================================
   STATISTICS
========================================================= */

function updateStatistics() {

    const reviews =
        JSON.parse(
            localStorage.getItem(
                "campusVoiceReviews"
            )
        ) || [];


    const total =
        reviews.length;


    let ratingTotal = 0;

    let replyTotal = 0;


    reviews.forEach(
        review => {

            ratingTotal +=
                Number(review.rating);


            if (review.replies) {

                replyTotal +=
                    review.replies.length;
            }

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
   INITIALIZE
========================================================= */

window.addEventListener(
    "load",
    function() {

        const savedUser =
            localStorage.getItem(
                "campusVoiceCurrentUser"
            );


        if (savedUser) {

            currentUser =
                JSON.parse(savedUser);


            openMainPage();

        } else {

            landingPage.style.display =
                "flex";

            authPage.style.display =
                "none";

            mainPage.style.display =
                "none";
        }

    }
);
