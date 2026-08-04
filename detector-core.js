(function initDetectorCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ChatGPTNotifierCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function detectorCoreFactory() {
  function createDetector({ stableMs = 1400, fallbackStableMs = Math.max(4000, stableMs * 3) } = {}) {
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
      lastSubmissionAt = Number.isFinite(timestamp) ? timestamp : Date.now();
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

      if (!initialized) {
        initialized = true;
        lastAssistantCount = assistantCount;
        lastUserCount = userCount;
        lastAssistantSignature = assistantSignature;
        lastConversationSignature = conversationSignature;
        lastActionFingerprint = actionFingerprint;
        lastSendVisible = sendVisible;
        lastStopVisible = stopVisible;

        if (stopVisible || (awaitingResponse && !sendVisible)) {
          awaitingResponse = true;
          generating = true;
          activityObserved = true;
          lastContentChangeAt = now;
        }

        if (actionFingerprint) {
          events.push(actionEvent(snapshot));
        }

        return events;
      }

      if (actionFingerprint && actionFingerprint !== lastActionFingerprint) {
        events.push(actionEvent(snapshot));
      }
      lastActionFingerprint = actionFingerprint;

      const userAdded = userCount > lastUserCount;
      const assistantAdded = assistantCount > lastAssistantCount;
      const assistantChanged = Boolean(assistantSignature) && assistantSignature !== lastAssistantSignature;
      const conversationChanged =
        Boolean(conversationSignature) && conversationSignature !== lastConversationSignature;
      const hasAssistantSignal = assistantCount > 0 && Boolean(assistantSignature);

      if (userAdded && !awaitingResponse) {
        markUserSubmitted(now);
      }

      const firstScanAfterSubmission = submissionBaselinePending;
      submissionBaselinePending = false;

      const strongStartSignal =
        (stopVisible && !lastStopVisible) ||
        (awaitingResponse && !sendVisible && lastSendVisible) ||
        assistantAdded ||
        (assistantChanged && awaitingResponse);

      if (strongStartSignal) {
        if (stopVisible && !lastStopVisible) awaitingResponse = true;
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

      const idleFor = lastContentChangeAt === null ? 0 : now - lastContentChangeAt;
      const strongIdleSignal = !stopVisible && (sendVisible || hasAssistantSignal);
      const stableLongEnough = strongIdleSignal
        ? idleFor >= stableMs
        : !stopVisible && idleFor >= fallbackStableMs;
      const completionSignature = hasAssistantSignal ? assistantSignature : conversationSignature;

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
      }

      lastAssistantCount = assistantCount;
      lastUserCount = userCount;
      lastAssistantSignature = assistantSignature;
      lastConversationSignature = conversationSignature;
      lastSendVisible = sendVisible;
      lastStopVisible = stopVisible;

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
        lastStopVisible
      };
    }

    return { scan, markUserSubmitted, getState };
  }

  return { createDetector };
});
