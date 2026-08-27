export const HANDLE_REGEX = /^@?([A-Za-z0-9._]{2,24})$/;
export const YOUTUBE_TITLE_LIMIT = 100;
export const YOUTUBE_DESC_LIMIT = 5000;
export const YOUTUBE_TAGS_LIMIT = 15;
export function cleanHandle(input) {
    const m = input.trim().match(HANDLE_REGEX);
    return m ? m[1].toLowerCase() : null;
}
export function normalizeHashtags(tags) {
    return tags.map(t => t.replace(/^#/, '').toLowerCase()).filter(Boolean).slice(0, YOUTUBE_TAGS_LIMIT);
}
export function tiktokToYouTubeTitle(tiktokTitle, handle, addCredit) {
    let title = tiktokTitle.trim() || `TikTok @${handle}`;
    // YouTube Shorts: garder hashtags dans titre si présents
    if (title.length > YOUTUBE_TITLE_LIMIT)
        title = title.slice(0, YOUTUBE_TITLE_LIMIT - 3) + "...";
    return title;
}
export function tiktokToYouTubeDescription(video, addCredit) {
    const tags = video.hashtags.map(h => `#${h}`).join(" ");
    let desc = video.description || video.title || "";
    if (tags)
        desc += `\n\n${tags}`;
    if (addCredit)
        desc += `\n\nCrédit: @${video.handle} sur TikTok — Repost via TikTub`;
    desc += `\n\n#Shorts #TikTok`;
    if (desc.length > YOUTUBE_DESC_LIMIT)
        desc = desc.slice(0, YOUTUBE_DESC_LIMIT);
    return desc;
}
//# sourceMappingURL=constants.js.map