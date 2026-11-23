import logger from "shared/debug/log";
import browser from "webextension-polyfill";

class QuizService {
    
    init() {
        browser.runtime.onMessage.addListener(data => {
            if (data?.type !== "quiz-review-data")
                return;

            this.onReviewData(data.payload)
        });

        browser.runtime.onMessage.addListener(data => {
            if (data?.type !== "quiz-attempt-data")
                return;

            this.onAttemptData(data.payload);
        });

        logger.info("QuizService: initialized");
    }

    onReviewData(data) {
        console.log("Review data received");
    }

    onAttemptData(data) {
        console.log("Attempt data received", data);
    }

}

export default QuizService;
