export declare const HANDLE_REGEX: RegExp;
export declare const YOUTUBE_TITLE_LIMIT = 100;
export declare const YOUTUBE_DESC_LIMIT = 5000;
export declare const YOUTUBE_TAGS_LIMIT = 15;
export declare function cleanHandle(input: string): string | null;
export declare function normalizeHashtags(tags: string[]): string[];
export declare function tiktokToYouTubeTitle(tiktokTitle: string, handle: string, addCredit: boolean): string;
export declare function tiktokToYouTubeDescription(video: {
    title: string;
    description: string;
    hashtags: string[];
    handle: string;
}, addCredit: boolean): string;
//# sourceMappingURL=constants.d.ts.map