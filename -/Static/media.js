/* =========================================================
   CAMPUSVOICE MEDIA
   Photos, videos and Live Photos for feedback posts.

   - Photos are resized and converted to WebP in the browser,
     so a 6 MB phone photo uploads as a few hundred KB.
   - Videos are checked (type, size, length) and uploaded as is.
   - A Live Photo is a photo plus a short video of the moment.
   - Nothing is uploaded until "Submit Feedback" is pressed.

   Every limit below is checked again by the server (app.py),
   so the page can warn early but can't be used to get around them.
========================================================= */


/* =========================================================
   LIMITS
   Keep these in step with MAX_*_BYTES in app.py.
========================================================= */

const MEDIA_LIMITS = {

    // A photo as picked from the phone or computer, before compression
    photoPickedBytes: 20 * 1024 * 1024,

    // The most a photo may be once uploaded (also the cap for GIFs,
    // which can't be compressed without losing the animation)
    photoUploadBytes: 5 * 1024 * 1024,

    // Longest side of an uploaded photo, in pixels
    photoMaxSide: 1600,

    // WebP / JPEG quality from 0 to 1
    photoQuality: 0.82,

    videoBytes: 30 * 1024 * 1024,

    videoSeconds: 30,

    // The short clip that goes with a Live Photo
    liveVideoBytes: 8 * 1024 * 1024,

    liveVideoSeconds: 5

};


/* =========================================================
   STATE
========================================================= */

/*
   What is currently picked, once it has been checked:

   {
       kind:      "image" | "video" | "live",
       image:     Blob or null   (already compressed)
       imageName: file name to upload it under
       video:     Blob or null
       videoName: file name to upload it under
       imageUrl / videoUrl: temporary preview addresses
       uploaded:  { image, video, live } once sent to the server
   }
*/

let currentMedia = null;

// True while a picked file is still being checked / compressed
let mediaBusy = false;

// Lets a newer pick cancel an older one that is still working
let mediaToken = 0;


// Errors whose message is meant to be shown to the person
class MediaError extends Error {}


/* =========================================================
   SMALL HELPERS
========================================================= */

function formatBytes(bytes) {

    if (bytes >= 1024 * 1024) {

        return (bytes / 1024 / 1024).toFixed(1) + " MB";
    }

    if (bytes >= 1024) {

        return Math.round(bytes / 1024) + " KB";
    }

    return bytes + " B";
}


function formatSeconds(seconds) {

    return seconds.toFixed(seconds < 10 ? 1 : 0) + " s";
}


function stripExtension(name) {

    return String(name || "").replace(/\.[^./\\]+$/, "");
}


// Used to match IMG_1234.HEIC with IMG_1234.MOV
function matchKey(name) {

    return stripExtension(name).toLowerCase();
}


function readBytes(blob) {

    if (blob.arrayBuffer) {

        return blob.arrayBuffer().then(
            buffer => new Uint8Array(buffer)
        );
    }

    // Older browsers
    return new Promise((resolve, reject) => {

        const reader = new FileReader();

        reader.onload = () =>
            resolve(new Uint8Array(reader.result));

        reader.onerror = () =>
            reject(reader.error);

        reader.readAsArrayBuffer(blob);
    });
}


// Characters of a byte range, for reading file signatures
function asciiAt(bytes, start, end) {

    let text = "";

    for (let i = start; i < end && i < bytes.length; i++) {

        text += String.fromCharCode(bytes[i]);
    }

    return text;
}


/* =========================================================
   WHAT KIND OF FILE IS THIS?
   Decided from the file's first bytes, because the file
   name and the browser's idea of the type are unreliable
   (a .mov often has no type at all).
========================================================= */

// MP4-family brands that are photos, not video
const HEIC_BRANDS = [
    "heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"
];

// Brands that are neither a supported photo nor a video
const REJECTED_BRANDS = [
    "avif", "avis", "M4A ", "M4B ", "M4P "
];


/*
   Returns { kind: "image" | "video", type, animated } or null
   when the file isn't something we accept.
*/

function sniffMedia(bytes) {

    if (
        bytes[0] === 0xFF &&
        bytes[1] === 0xD8 &&
        bytes[2] === 0xFF
    ) {

        return { kind: "image", type: "jpeg", animated: false };
    }


    if (
        bytes[0] === 0x89 &&
        asciiAt(bytes, 1, 8) === "PNG\r\n\x1a\n"
    ) {

        return {
            kind: "image",
            type: "png",
            animated: isAnimatedPng(bytes)
        };
    }


    const gifStart = asciiAt(bytes, 0, 6);

    if (gifStart === "GIF87a" || gifStart === "GIF89a") {

        // Treated as animated: a canvas would keep only one frame
        return { kind: "image", type: "gif", animated: true };
    }


    if (
        asciiAt(bytes, 0, 4) === "RIFF" &&
        asciiAt(bytes, 8, 12) === "WEBP"
    ) {

        // An extended WebP header has a flag for animation
        const animated =
            asciiAt(bytes, 12, 16) === "VP8X" &&
            (bytes[20] & 0x02) !== 0;

        return { kind: "image", type: "webp", animated: animated };
    }


    if (
        bytes[0] === 0x1A &&
        bytes[1] === 0x45 &&
        bytes[2] === 0xDF &&
        bytes[3] === 0xA3
    ) {

        // WebM and Matroska (.mkv) share a header; only WebM is allowed
        return asciiAt(bytes, 0, 64).includes("webm")
            ? { kind: "video", type: "webm", animated: false }
            : null;
    }


    if (asciiAt(bytes, 4, 8) === "ftyp") {

        const brand = asciiAt(bytes, 8, 12);

        if (HEIC_BRANDS.includes(brand)) {

            return { kind: "image", type: "heic", animated: false };
        }

        if (REJECTED_BRANDS.includes(brand)) {

            return null;
        }

        return {
            kind: "video",
            type: brand === "qt  " ? "mov" : "mp4",
            animated: false
        };
    }


    return null;
}


// PNGs are a list of chunks; an animated one has an "acTL" chunk
function isAnimatedPng(bytes) {

    let position = 8;

    while (position + 8 <= bytes.length) {

        const length = (
            (bytes[position] << 24) |
            (bytes[position + 1] << 16) |
            (bytes[position + 2] << 8) |
            bytes[position + 3]
        ) >>> 0;

        const type = asciiAt(bytes, position + 4, position + 8);

        if (type === "acTL") {

            return true;
        }

        if (type === "IDAT" || type === "IEND") {

            return false;
        }

        position += 12 + length;
    }

    return false;
}


async function sniffFile(file) {

    const info = sniffMedia(
        await readBytes(file.slice(0, 64 * 1024))
    );

    if (!info) {

        throw new MediaError(
            "\"" + file.name + "\" isn't a supported file. " +
            "Please use a JPG, PNG, WebP or GIF photo, " +
            "or an MP4, WebM or MOV video."
        );
    }

    return info;
}


/* =========================================================
   PHOTOS: RESIZE + CONVERT TO WEBP
========================================================= */

let webpEncodeSupported = null;


// Chrome, Edge and Firefox can save WebP from a canvas.
// Safari can't: it quietly hands back a PNG instead.
function canEncodeWebp() {

    if (webpEncodeSupported === null) {

        const probe = document.createElement("canvas");

        probe.width = 1;

        probe.height = 1;

        webpEncodeSupported =
            probe
                .toDataURL("image/webp")
                .startsWith("data:image/webp");
    }

    return webpEncodeSupported;
}


function canvasToBlob(canvas, type, quality) {

    return new Promise(
        resolve => canvas.toBlob(resolve, type, quality)
    );
}


function drawAndEncode(image, width, height, type, quality) {

    const canvas = document.createElement("canvas");

    canvas.width = width;

    canvas.height = height;

    const context = canvas.getContext("2d");

    if (type === "image/jpeg") {

        // JPEG has no transparency, so use a white background
        context.fillStyle = "#ffffff";

        context.fillRect(0, 0, width, height);
    }

    context.imageSmoothingQuality = "high";

    context.drawImage(image, 0, 0, width, height);

    return canvasToBlob(canvas, type, quality);
}


/*
   Returns { blob, name, width, height, label }.
   Re-drawing the photo also drops its hidden metadata
   (camera details, GPS location) before it is uploaded.
*/

async function compressImage(file, info) {

    const url = URL.createObjectURL(file);

    try {

        const image = new Image();

        image.src = url;

        try {

            await image.decode();

        } catch (failure) {

            throw new MediaError(
                info.type === "heic"
                    ? "This browser can't open HEIC photos. Please " +
                      "use a JPG, PNG or WebP photo (on iPhone: " +
                      "Settings > Camera > Formats > Most Compatible)."
                    : "That photo couldn't be opened. " +
                      "The file may be damaged."
            );
        }


        // The browser already turns the photo upright (EXIF rotation)
        const width = image.naturalWidth;

        const height = image.naturalHeight;

        if (!width || !height) {

            throw new MediaError(
                "That photo couldn't be opened. " +
                "The file may be damaged."
            );
        }


        const asWebp = canEncodeWebp();

        const type = asWebp ? "image/webp" : "image/jpeg";

        let scale = Math.min(
            1,
            MEDIA_LIMITS.photoMaxSide / Math.max(width, height)
        );

        let quality = MEDIA_LIMITS.photoQuality;

        let blob = null;

        let outWidth = width;

        let outHeight = height;


        // Normally one pass is enough. A very detailed photo that is
        // still too big gets a little smaller and softer each time.
        for (let attempt = 0; attempt < 5; attempt++) {

            outWidth = Math.max(1, Math.round(width * scale));

            outHeight = Math.max(1, Math.round(height * scale));

            blob = await drawAndEncode(
                image, outWidth, outHeight, type, quality
            );

            if (
                blob &&
                blob.size <= MEDIA_LIMITS.photoUploadBytes
            ) {

                break;
            }

            quality = Math.max(0.5, quality - 0.1);

            scale *= 0.8;
        }


        if (
            !blob ||
            blob.size > MEDIA_LIMITS.photoUploadBytes
        ) {

            throw new MediaError(
                "That photo is still too large after compression. " +
                "Please choose a smaller one."
            );
        }


        // A WebP that is already small can't always be beaten
        if (
            info.type === "webp" &&
            outWidth === width &&
            outHeight === height &&
            blob.size >= file.size &&
            file.size <= MEDIA_LIMITS.photoUploadBytes
        ) {

            return {
                blob: file,
                name: file.name,
                width: width,
                height: height,
                label: "WebP, already small"
            };
        }


        return {
            blob: blob,
            name: stripExtension(file.name) +
                (asWebp ? ".webp" : ".jpg"),
            width: outWidth,
            height: outHeight,
            label: asWebp ? "WebP" : "JPEG"
        };

    } finally {

        URL.revokeObjectURL(url);
    }
}


async function prepareImage(file, info) {

    if (file.size > MEDIA_LIMITS.photoPickedBytes) {

        throw new MediaError(
            "That photo is " + formatBytes(file.size) +
            ". Please choose one under " +
            formatBytes(MEDIA_LIMITS.photoPickedBytes) + "."
        );
    }


    // GIFs and other animated images are sent untouched
    if (info.animated) {

        if (file.size > MEDIA_LIMITS.photoUploadBytes) {

            throw new MediaError(
                "Animated images can't be compressed here, so they " +
                "must be under " +
                formatBytes(MEDIA_LIMITS.photoUploadBytes) +
                " (this one is " + formatBytes(file.size) + ")."
            );
        }

        return {
            kind: "image",
            image: file,
            imageName: file.name,
            summary:
                "Animated image ready (" + formatBytes(file.size) + ")."
        };
    }


    // An Android "Motion Photo" is a JPEG with a short video inside
    if (info.type === "jpeg") {

        const live = await tryMotionPhoto(file, info);

        if (live) {

            return live;
        }
    }


    const result = await compressImage(file, info);

    return {
        kind: "image",
        image: result.blob,
        imageName: result.name,
        summary:
            "Photo ready: " + formatBytes(file.size) + " → " +
            formatBytes(result.blob.size) + " (" + result.label +
            ", " + result.width + "×" + result.height + ")."
    };
}


/* =========================================================
   VIDEOS: TYPE, SIZE, LENGTH, CAN THE BROWSER PLAY IT?
========================================================= */

/*
   Opens the video just far enough to learn its length and
   size. Rejects if the browser can't play it at all. If the
   browser stays silent (some phones don't preload), the video
   is let through with unknown details.
*/

function probeVideo(blob) {

    return new Promise((resolve, reject) => {

        const video = document.createElement("video");

        const url = URL.createObjectURL(blob);

        let finished = false;

        let timer = null;


        function finish(settle, value) {

            if (finished) {

                return;
            }

            finished = true;

            clearTimeout(timer);

            video.removeAttribute("src");

            video.load();

            URL.revokeObjectURL(url);

            settle(value);
        }


        timer = setTimeout(
            () => finish(resolve, { unknown: true }),
            15000
        );

        video.preload = "metadata";

        video.muted = true;

        video.playsInline = true;

        video.onloadedmetadata = () => finish(
            resolve,
            {
                duration: video.duration,
                width: video.videoWidth,
                height: video.videoHeight
            }
        );

        video.onerror = () => finish(
            reject,
            new Error("unplayable")
        );

        video.src = url;
    });
}


/*
   Checks one video against a size and length limit.
   Returns { seconds } (NaN when the length can't be read).
*/

async function checkVideo(file, maxBytes, maxSeconds, what) {

    if (file.size > maxBytes) {

        throw new MediaError(
            "That " + what + " is " + formatBytes(file.size) +
            ". The limit is " + formatBytes(maxBytes) + "."
        );
    }

    let details;

    try {

        details = await probeVideo(file);

    } catch (failure) {

        throw new MediaError(
            "This browser can't play that " + what + ". " +
            "Please use an MP4 (H.264) or WebM video."
        );
    }


    if (details.unknown) {

        return { seconds: NaN };
    }


    if (details.width === 0) {

        throw new MediaError(
            "No picture was found in that " + what + "."
        );
    }


    if (
        Number.isFinite(details.duration) &&
        details.duration > maxSeconds
    ) {

        throw new MediaError(
            "That " + what + " is " +
            formatSeconds(details.duration) + " long. " +
            "The limit is " + maxSeconds + " seconds."
        );
    }


    return { seconds: details.duration };
}


async function prepareVideo(file) {

    const check = await checkVideo(
        file,
        MEDIA_LIMITS.videoBytes,
        MEDIA_LIMITS.videoSeconds,
        "video"
    );

    return {
        kind: "video",
        video: file,
        videoName: file.name,
        summary:
            "Video ready: " + formatBytes(file.size) +
            (Number.isFinite(check.seconds)
                ? ", " + formatSeconds(check.seconds)
                : "") + "."
    };
}


/* =========================================================
   LIVE PHOTOS
   A Live Photo is a still photo plus a ~3 second video.
   Phones keep them as two files:

   - iPhone: IMG_1234.HEIC (or .JPG) + IMG_1234.MOV. Pick
     both at once and they are paired by file name.
   - Android "Motion Photo": one JPEG with the video hidden
     inside it. We pull the video out of the file.

   The web can't read the video of an iPhone Live Photo
   picked straight from the gallery (only the still comes
   through), so on iPhone the two files must be exported.
========================================================= */

async function prepareLivePhoto(photoFile, photoInfo, videoFile) {

    // Check the video first (it is quick); then shrink the photo
    const check = await checkVideo(
        videoFile,
        MEDIA_LIMITS.liveVideoBytes,
        MEDIA_LIMITS.liveVideoSeconds,
        "Live Photo video"
    );

    if (photoFile.size > MEDIA_LIMITS.photoPickedBytes) {

        throw new MediaError(
            "That photo is " + formatBytes(photoFile.size) +
            ". Please choose one under " +
            formatBytes(MEDIA_LIMITS.photoPickedBytes) + "."
        );
    }

    const result = await compressImage(photoFile, photoInfo);

    return {
        kind: "live",
        image: result.blob,
        imageName: result.name,
        video: videoFile,
        videoName: videoFile.name || "live.mp4",
        summary:
            "Live Photo ready: photo " +
            formatBytes(photoFile.size) + " → " +
            formatBytes(result.blob.size) + " (" + result.label +
            ") + " +
            (Number.isFinite(check.seconds)
                ? formatSeconds(check.seconds) + " "
                : "") +
            "video."
    };
}


/*
   Looks for the video hidden inside an Android Motion Photo.
   Returns it as a Blob, or null if this JPEG has none.

   The JPEG's XMP metadata says how long the video is, and the
   video simply sits at the very end of the file.
*/

async function extractMotionPhotoVideo(file) {

    const head = await readBytes(file.slice(0, 256 * 1024));

    const text = asciiAt(head, 0, head.length);

    const xmpStart = text.indexOf("<x:xmpmeta");

    const xmpEnd = text.indexOf("</x:xmpmeta>");

    if (xmpStart === -1 || xmpEnd === -1) {

        return null;
    }

    const xmp = text.slice(xmpStart, xmpEnd);

    let videoBytes = 0;


    // Newer phones list each part of the file; the video's entry
    // says how many bytes it takes up
    const items = xmp.match(/<Container:Item\b[^>]*>/g) || [];

    for (const item of items) {

        if (/Item:Mime\s*=\s*"video\/mp4"/.test(item)) {

            const length = /Item:Length\s*=\s*"(\d+)"/.exec(item);

            if (length) {

                videoBytes = Number(length[1]);
            }
        }
    }


    // Older Pixel phones give the distance from the end instead
    if (!videoBytes) {

        const offset = /MicroVideoOffset\s*=\s*"(\d+)"/.exec(xmp);

        if (offset) {

            videoBytes = Number(offset[1]);
        }
    }


    if (videoBytes <= 0 || videoBytes >= file.size) {

        return null;
    }


    // Make sure what is there really is an MP4 before trusting it
    const start = file.size - videoBytes;

    const signature = await readBytes(
        file.slice(start, start + 12)
    );

    if (asciiAt(signature, 4, 8) !== "ftyp") {

        return null;
    }

    return file.slice(start, file.size, "video/mp4");
}


// A Motion Photo becomes a Live Photo; anything that doesn't
// check out just falls back to being an ordinary photo
async function tryMotionPhoto(file, info) {

    let video;

    try {

        video = await extractMotionPhotoVideo(file);

    } catch (failure) {

        return null;
    }

    if (!video) {

        return null;
    }

    try {

        const name = stripExtension(file.name) + ".mp4";

        const clip = new File([video], name, { type: "video/mp4" });

        return await prepareLivePhoto(file, info, clip);

    } catch (failure) {

        if (failure instanceof MediaError) {

            // For example a clip that is too long
            return null;
        }

        throw failure;
    }
}


/* =========================================================
   WORK OUT WHAT WAS PICKED
========================================================= */

async function prepareMedia(files) {

    if (files.length > 2) {

        throw new MediaError(
            "Please choose one photo or one video. For a Live " +
            "Photo, choose the photo and its video together."
        );
    }


    const picked = [];

    for (const file of files) {

        picked.push({ file: file, info: await sniffFile(file) });
    }


    if (picked.length === 2) {

        const photo = picked.find(item => item.info.kind === "image");

        const video = picked.find(item => item.info.kind === "video");

        if (!photo || !video) {

            throw new MediaError(
                "To share a Live Photo, choose one photo and its " +
                "video together. Otherwise choose a single photo " +
                "or a single video."
            );
        }

        if (matchKey(photo.file.name) !== matchKey(video.file.name)) {

            throw new MediaError(
                "These two files don't belong together (\"" +
                photo.file.name + "\" and \"" + video.file.name +
                "\"). A Live Photo's photo and video share a file " +
                "name, like IMG_1234.JPG and IMG_1234.MOV."
            );
        }

        return prepareLivePhoto(photo.file, photo.info, video.file);
    }


    const only = picked[0];

    return only.info.kind === "video"
        ? prepareVideo(only.file)
        : prepareImage(only.file, only.info);
}


/* =========================================================
   PICKER (the file input in the feedback form)
========================================================= */

function setMediaStatus(message, state) {

    const status = document.getElementById("mediaStatus");

    status.textContent = message || "";

    status.className =
        "media-status" + (state ? " " + state : "");
}


function revokeMediaUrls() {

    if (!currentMedia) {

        return;
    }

    if (currentMedia.imageUrl) {

        URL.revokeObjectURL(currentMedia.imageUrl);
    }

    if (currentMedia.videoUrl) {

        URL.revokeObjectURL(currentMedia.videoUrl);
    }
}


// Forget the picked file and put the picker back to empty
function resetMediaPicker() {

    mediaToken++;

    mediaBusy = false;

    revokeMediaUrls();

    currentMedia = null;

    const input = document.getElementById("photoInput");

    input.value = "";

    input.disabled = false;

    const preview = document.getElementById("mediaPreview");

    preview.innerHTML = "";

    preview.classList.add("hidden");

    document
        .getElementById("mediaRemove")
        .classList.add("hidden");

    document
        .getElementById("mediaProgress")
        .classList.add("hidden");

    setMediaStatus("", "");
}


function showMediaPreview() {

    const preview = document.getElementById("mediaPreview");

    preview.innerHTML = "";

    const element = buildMediaElement({
        image: currentMedia.imageUrl,
        video: currentMedia.videoUrl,
        live: currentMedia.kind === "live"
    });

    if (element) {

        preview.appendChild(element);
    }

    preview.classList.remove("hidden");

    document
        .getElementById("mediaRemove")
        .classList.remove("hidden");
}


async function handleMediaSelect(event) {

    const input = event.target;

    const files = Array.from(input.files || []);


    // The dialog was cancelled: the input is empty again
    if (files.length === 0) {

        resetMediaPicker();

        return;
    }


    // Start from a clean slate, then work on the new pick
    revokeMediaUrls();

    currentMedia = null;

    document.getElementById("mediaPreview").classList.add("hidden");

    document.getElementById("mediaRemove").classList.add("hidden");

    const token = ++mediaToken;

    mediaBusy = true;

    setMediaStatus("Getting your file ready...", "busy");


    let media;

    try {

        media = await prepareMedia(files);

    } catch (failure) {

        if (token !== mediaToken) {

            return;
        }

        mediaBusy = false;

        input.value = "";

        if (failure instanceof MediaError) {

            setMediaStatus(failure.message, "error");

        } else {

            console.error(failure);

            setMediaStatus(
                "Something went wrong while reading that file. " +
                "Please try another one.",
                "error"
            );
        }

        return;
    }


    // The person picked something else in the meantime
    if (token !== mediaToken) {

        return;
    }

    mediaBusy = false;

    media.imageUrl = media.image
        ? URL.createObjectURL(media.image)
        : "";

    media.videoUrl = media.video
        ? URL.createObjectURL(media.video)
        : "";

    currentMedia = media;

    showMediaPreview();

    setMediaStatus(media.summary, "ok");
}


/* =========================================================
   UPLOAD
   Sent as a normal file upload (not base64), one file at a
   time, with progress. The header is required by the server.
========================================================= */

function uploadFile(blob, name, onBytes) {

    return new Promise((resolve, reject) => {

        const form = new FormData();

        form.append("file", blob, name);

        const request = new XMLHttpRequest();

        request.open("POST", "/api/media");

        request.setRequestHeader("X-CampusVoice-Upload", "1");

        request.responseType = "json";

        request.upload.onprogress = event => {

            if (event.lengthComputable) {

                onBytes(Math.min(event.loaded, blob.size));
            }
        };

        request.onload = () => {

            const data = request.response || {};

            if (request.status >= 200 && request.status < 300) {

                resolve(data);

            } else {

                reject(new Error(data.error || "The upload failed."));
            }
        };

        request.onerror = () => reject(new Error(
            "The upload failed. The server may be unreachable " +
            "or the file may be too large."
        ));

        request.onabort = () => reject(new Error(
            "The upload was cancelled."
        ));

        request.send(form);
    });
}


/*
   Uploads whatever is picked. onProgress gets a number from
   0 to 1. Returns { image, video, live } with the file URLs
   to save in the post ("" when there is none).
*/

async function uploadCurrentMedia(onProgress) {

    if (!currentMedia) {

        return { image: "", video: "", live: false };
    }


    // Already uploaded (for example a retry after the post failed)
    if (currentMedia.uploaded) {

        return currentMedia.uploaded;
    }


    const parts = [];

    if (currentMedia.image) {

        parts.push({
            field: "image",
            blob: currentMedia.image,
            name: currentMedia.imageName
        });
    }

    if (currentMedia.video) {

        parts.push({
            field: "video",
            blob: currentMedia.video,
            name: currentMedia.videoName
        });
    }


    const total =
        parts.reduce((sum, part) => sum + part.blob.size, 0) || 1;

    let finished = 0;

    const result = {
        image: "",
        video: "",
        live: currentMedia.kind === "live"
    };

    onProgress(0);

    for (const part of parts) {

        const data = await uploadFile(
            part.blob,
            part.name,
            bytes => onProgress((finished + bytes) / total)
        );

        result[part.field] = data.url;

        finished += part.blob.size;
    }

    onProgress(1);

    currentMedia.uploaded = result;

    return result;
}


/* =========================================================
   SHOWING MEDIA
   Used for the preview in the form and for posts in the feed.
   Built with DOM calls (not HTML strings) so a file address
   can never be read as markup.

   media = { image: url, video: url, live: true/false }
========================================================= */

function buildMediaElement(media) {

    if (media.live && media.image && media.video) {

        return buildLivePhoto(media.image, media.video);
    }

    if (media.video) {

        return buildVideo(media.video);
    }

    if (media.image) {

        return buildPhoto(media.image);
    }

    return null;
}


function buildPhoto(url) {

    const image = document.createElement("img");

    image.className = "review-image";

    image.loading = "lazy";

    image.alt = "Photo attached to this feedback";

    image.src = url;

    return image;
}


function buildVideo(url) {

    const wrapper = document.createElement("div");

    const video = document.createElement("video");

    video.className = "review-video";

    video.controls = true;

    video.playsInline = true;

    video.preload = "metadata";

    // "#t=0.1" makes phones show the first frame instead of black
    video.src = url + "#t=0.1";

    // If this browser can't play it, offer the file instead
    video.addEventListener("error", () => {

        const message = document.createElement("p");

        message.className = "media-fallback";

        message.textContent =
            "This video can't be played in your browser. ";

        const link = document.createElement("a");

        link.href = url;

        link.download = "";

        link.textContent = "Download it";

        message.appendChild(link);

        wrapper.replaceChildren(message);
    });

    wrapper.appendChild(video);

    return wrapper;
}


/*
   Hover (mouse) or press and hold (touch) to play, like the
   Photos app. The LIVE badge also works from the keyboard.
*/

function buildLivePhoto(imageUrl, videoUrl) {

    const box = document.createElement("div");

    box.className = "live-photo";

    const image = document.createElement("img");

    image.className = "review-image";

    image.loading = "lazy";

    image.alt = "Live Photo attached to this feedback";

    image.draggable = false;

    image.src = imageUrl;

    const video = document.createElement("video");

    video.className = "live-video";

    video.muted = true;

    video.loop = true;

    video.playsInline = true;

    video.preload = "metadata";

    video.src = videoUrl;

    const badge = document.createElement("button");

    badge.type = "button";

    badge.className = "live-badge";

    badge.textContent = "◉ LIVE";

    badge.title = "Hover or press and hold the photo to play";

    badge.setAttribute("aria-label", "Play Live Photo");

    badge.setAttribute("aria-pressed", "false");

    box.append(image, video, badge);


    let playing = false;


    function start() {

        if (playing) {

            return;
        }

        playing = true;

        box.classList.add("playing");

        badge.setAttribute("aria-pressed", "true");

        video.currentTime = 0;

        const attempt = video.play();

        if (attempt && attempt.catch) {

            attempt.catch(stop);
        }
    }


    function stop() {

        playing = false;

        box.classList.remove("playing");

        badge.setAttribute("aria-pressed", "false");

        video.pause();
    }


    box.addEventListener("pointerenter", event => {

        if (event.pointerType === "mouse") {

            start();
        }
    });

    box.addEventListener("pointerleave", event => {

        if (event.pointerType === "mouse") {

            stop();
        }
    });

    box.addEventListener("pointerdown", event => {

        if (event.pointerType !== "mouse") {

            start();
        }
    });

    ["pointerup", "pointercancel"].forEach(name => {

        box.addEventListener(name, event => {

            if (event.pointerType !== "mouse") {

                stop();
            }
        });
    });

    // Holding a finger on a photo would otherwise open a menu
    box.addEventListener("contextmenu", event => {

        event.preventDefault();
    });

    // Keyboard and screen readers: Enter / Space on the badge.
    // (A real mouse click has detail > 0 and is already handled
    // by hovering.)
    badge.addEventListener("click", event => {

        if (event.detail === 0) {

            playing ? stop() : start();
        }
    });

    // If the clip can't be played, it is just a normal photo
    video.addEventListener("error", () => {

        box.classList.add("no-video");
    });

    return box;
}


/* =========================================================
   SET UP THE PICKER
========================================================= */

function initMediaPicker() {

    const hint = document.getElementById("mediaHint");

    if (!hint) {

        return;
    }

    hint.textContent =
        "Photos (JPG, PNG, WebP, GIF) are compressed automatically. " +
        "Videos (MP4, WebM, MOV) can be up to " +
        formatBytes(MEDIA_LIMITS.videoBytes) + " and " +
        MEDIA_LIMITS.videoSeconds + " seconds. " +
        "For a Live Photo, choose the photo and its video together " +
        "(for example IMG_1234.JPG and IMG_1234.MOV).";
}


if (typeof document !== "undefined") {

    initMediaPicker();
}


// Lets the tests load the helpers in Node; browsers ignore this
if (typeof module !== "undefined" && module.exports) {

    module.exports = {
        MEDIA_LIMITS,
        MediaError,
        sniffMedia,
        isAnimatedPng,
        extractMotionPhotoVideo,
        matchKey,
        stripExtension,
        formatBytes
    };
}
