(function initDetectorCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ChatGPTNotifierCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function detectorCoreFactory() {
  function createDetector({ stableMs = 1400 } = {}) {
    let initialized = false;
    let generating = false;
    let awaitingResponse = false;
    let activityObserved = false;
    let submissionBaselinePending = false;
    let lastAssistantCount = 0;
    let lastUserCount = 0;
    let lastAssistantSignature = '';
    let lastConversationSignature = '';
    let lastContentChangeAt = null;
    let lastSubmissionAt = null;
    let lastActionFingerprint = null;
    let lastCompletedSignature = null;
    let lastSendVisible = false;
    let lastStopVisible = false;
    let stopObserved = false;
    let responseObserved = false;
    let completionCandidateAt = null;
    let manuallyStopped = false;
    let lastAssistantKey = '';
    let lastUserKey = '';
    let errorObserved = false;
    let restartArmed = true;

    function actionEvent(snapshot) {
      return {
        type: 'action_required',
        message: snapshot.actionLabel || 'ChatGPT is waiting for your action.'
      };
    }

    function markUserSubmitted(timestamp = Date.now()) {
      awaitingResponse = true;
      generating = false;
      activityObserved = false;
      submissionBaselinePending = true;
      lastContentChangeAt = null;
      stopObserved = false;
      responseObserved = false;
      completionCandidateAt = null;
      lastCompletedSignature = null;
      lastSubmissionAt = Number.isFinite(timestamp) ? timestamp : Date.now();
      manuallyStopped = false;
      errorObserved = false;
      restartArmed = true;
    }

    function markUserStopped() {
      manuallyStopped = true;
      awaitingResponse = false;
      generating = false;
      completionCandidateAt = null;
      restartArmed = false;
    }

    function scan(snapshot) {
      const events = [];
      const now = Number.isFinite(snapshot.now) ? snapshot.now : Date.now();
      const assistantCount = snapshot.assistantCount || 0;
      const userCount = snapshot.userCount || 0;
      const assistantSignature = snapshot.lastAssistantSignature || '';
      const assistantText = snapshot.lastAssistantText || '';
      const conversationSignature = snapshot.conversationSignature || '';
      const conversationTail = snapshot.conversationTail || '';
      const actionFingerprint = snapshot.actionFingerprint || null;
      const sendVisible = Boolean(snapshot.sendVisible);
      const stopVisible = Boolean(snapshot.stopVisible);
      const assistantKey = snapshot.lastAssistantKey || '';
      const userKey = snapshot.lastUserKey || '';

      if (!initialized) {
        initialized = true;
        lastAssistantCount = assistantCount;
        lastUserCount = userCount;
        lastAssistantSignature = assistantSignature;
        lastConversationSignature = conversationSignature;
        lastActionFingerprint = actionFingerprint;
        lastSendVisible = sendVisible;
        lastStopVisible = stopVisible;
        lastAssistantKey = assistantKey;
        lastUserKey = userKey;

        if (stopVisible && !manuallyStopped && !snapshot.hasError) {
          awaitingResponse = true;
          generating = true;
          activityObserved = true;
          lastContentChangeAt = now;
          responseObserved = Boolean(assistantText);
        }

        if (snapshot.hasError && (awaitingResponse || stopVisible)) {
          errorObserved = true;
          awaitingResponse = false;
          generating = false;
          restartArmed = false;
        }
        if (!stopVisible) restartArmed = true;

        stopObserved = stopVisible;

        if (actionFingerprint) {
          events.push(actionEvent(snapshot));
        }

        return events;
      }

      if (actionFingerprint && actionFingerprint !== lastActionFingerprint) {
        events.push(actionEvent(snapshot));
      }
      lastActionFingerprint = actionFingerprint;

      const userAdded = userCount > lastUserCount || Boolean(userKey && userKey !== lastUserKey);
      const assistantAdded = assistantCount > lastAssistantCount || Boolean(assistantKey && assistantKey !== lastAssistantKey);
      const assistantChanged = Boolean(assistantSignature) && assistantSignature !== lastAssistantSignature;
      const conversationChanged =
        Boolean(conversationSignature) && conversationSignature !== lastConversationSignature;

      // A clicked Stop can remain in the DOM until React updates. Do not
      // mistake that lingering control for the start of another generation.
      const canRestart = !(manuallyStopped || errorObserved) || restartArmed;
      if (userAdded && !awaitingResponse && canRestart) {
        markUserSubmitted(now);
      }

      const firstScanAfterSubmission = submissionBaselinePending;
      submissionBaselinePending = false;

      if (stopVisible && !lastStopVisible && !awaitingResponse && canRestart) {
        markUserSubmitted(now);
      }
      // A previous reply or a changing thinking/tool status is not a new reply.
      if (awaitingResponse && (assistantAdded || assistantChanged) && assistantText) {
        responseObserved = true;
      }
      if (awaitingResponse && stopVisible) stopObserved = true;
      if (awaitingResponse && snapshot.hasError) {
        errorObserved = true;
        awaitingResponse = false;
        generating = false;
        restartArmed = false;
      }

      const strongStartSignal =
        (stopVisible && !lastStopVisible) ||
        (awaitingResponse && !sendVisible && lastSendVisible) ||
        assistantAdded ||
        (assistantChanged && awaitingResponse);

      if (awaitingResponse && strongStartSignal) {
        generating = true;
        activityObserved = true;
        lastContentChangeAt = now;
      } else if (awaitingResponse && conversationChanged && !firstScanAfterSubmission) {
        generating = true;
        activityObserved = true;
        lastContentChangeAt = now;
      } else if (generating && conversationChanged) {
        lastContentChangeAt = now;
      }

      // The latest reply's action bar corroborates final output. Composer Send
      // may be hidden when the input is empty and is not a completion signal.
      const completionCandidate =
        stopObserved && responseObserved && !stopVisible && Boolean(assistantText) &&
        snapshot.finalReady === true && !snapshot.streamingVisible &&
        !snapshot.hasError && !errorObserved && !actionFingerprint && !manuallyStopped;
      if (!completionCandidate || assistantChanged || assistantAdded || userAdded) {
        completionCandidateAt = null;
      }
      if (completionCandidate && completionCandidateAt === null) completionCandidateAt = now;
      const stableLongEnough = completionCandidateAt !== null && now - completionCandidateAt >= stableMs;
      const completionSignature = assistantSignature;

      if (
        generating &&
        awaitingResponse &&
        activityObserved &&
        stableLongEnough &&
        completionSignature &&
        completionSignature !== lastCompletedSignature
      ) {
        events.push({
          type: 'response_complete',
          message: assistantText || conversationTail || 'Your ChatGPT response is ready.'
        });
        generating = false;
        awaitingResponse = false;
        activityObserved = false;
        lastCompletedSignature = completionSignature;
        lastContentChangeAt = null;
        stopObserved = false;
        responseObserved = false;
        completionCandidateAt = null;
      }

      lastAssistantCount = assistantCount;
      lastUserCount = userCount;
      lastAssistantSignature = assistantSignature;
      lastConversationSignature = conversationSignature;
      lastSendVisible = sendVisible;
      lastStopVisible = stopVisible;
      lastAssistantKey = assistantKey;
      lastUserKey = userKey;
      if (!stopVisible) restartArmed = true;

      return events;
    }

    function getState() {
      return {
        initialized,
        generating,
        awaitingResponse,
        activityObserved,
        submissionBaselinePending,
        lastAssistantCount,
        lastUserCount,
        lastAssistantSignature,
        lastConversationSignature,
        lastContentChangeAt,
        lastSubmissionAt,
        lastActionFingerprint,
        lastSendVisible,
        lastStopVisible,
        stopObserved,
        responseObserved,
        completionCandidateAt,
        manuallyStopped,
        lastAssistantKey,
        lastUserKey,
        errorObserved,
        restartArmed
      };
    }

    return { scan, markUserSubmitted, markUserStopped, getState };
  }

  return { createDetector };
});
