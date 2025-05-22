if (typeof window.calendarInteractionState === "undefined") {
  window.calendarInteractionState = { isResizing: false };
}

let resizeMode = null;
let resizedEventId = null;
let originalResizedEvent = null;
let lastValidResizeTargetInfo = null;
let currentHoverTargetElement = null;
let resizeInitialLevel = 0;
let resizeCurrentViewAppZone = "UTC";
let lastPreviewRecalculationTargetKey = null;

// Cached values during a resize operation
let activeResizeOperationCache = {
  currentView: null,
  daysContainer: null,
  allDayColumns: [],
};

const THROTTLE_LIMIT_MS = 100;
const RESIZE_HANDLE_WIDTH_PX = 10;
const RESIZE_OBSTRUCTING_IGNORE_CLASS = "resize-obstructing-overlay-ignore";
const RESIZING_ORIGINAL_HIDDEN_CLASS = "resizing-original-hidden";
const PREVIEW_SEGMENT_CLASS = "resize-preview-segment";
const WEEK_RESIZE_PREVIEW_CLASS = "week-resize-preview-block";
const RESIZE_TARGET_HOVER_CLASS = "resize-target-hover";
const COLLIDING_PREVIEW_CLASS = "colliding";
const HOUR_HEIGHT_IN_WEEK_VIEW = 40;

function throttle(func, limit) {
  let timeoutId = null;
  let lastRanArgs = null;
  let lastRanContext = null;
  let lastExecutionTime = 0;
  const throttled = function (...args) {
    lastRanContext = this;
    lastRanArgs = args;
    const now = Date.now();
    if (!timeoutId) {
      const timeSinceLastExec = now - lastExecutionTime;
      if (timeSinceLastExec >= limit) {
        func.apply(lastRanContext, lastRanArgs);
        lastExecutionTime = now;
      } else {
        timeoutId = setTimeout(() => {
          func.apply(lastRanContext, lastRanArgs);
          lastExecutionTime = Date.now();
          timeoutId = null;
        }, limit - timeSinceLastExec);
      }
    }
  };
  throttled.cancel = function () {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
  return throttled;
}
const throttledRenderPreview = throttle((data) => renderResizePreview(data), THROTTLE_LIMIT_MS);

function clearResizePreview() {
  document.querySelectorAll(`.${PREVIEW_SEGMENT_CLASS}, .${WEEK_RESIZE_PREVIEW_CLASS}`).forEach((el) => el.remove());
}

function prepareLuxonDtsForPreview(eventDataForPreview, displayZone) {
  const previewCopy = JSON.parse(JSON.stringify(eventDataForPreview));
  previewCopy._isAllDay = !previewCopy.start_utc;

  if (previewCopy._isAllDay) {
    try {
      previewCopy._startDt = luxon.DateTime.fromISO(previewCopy.start, { zone: displayZone }).startOf("day");
      previewCopy._endDt = luxon.DateTime.fromISO(previewCopy.end, { zone: displayZone }).endOf("day");
    } catch (e) {
      previewCopy._startDt = luxon.DateTime.invalid("Error parsing all-day start/end");
      previewCopy._endDt = luxon.DateTime.invalid("Error parsing all-day start/end");
    }
  } else {
    if (previewCopy.start_utc && previewCopy.end_utc) {
      try {
        previewCopy._startDt = luxon.DateTime.fromISO(previewCopy.start_utc, { zone: "utc" });
        previewCopy._endDt = luxon.DateTime.fromISO(previewCopy.end_utc, { zone: "utc" });
      } catch (e) {
        previewCopy._startDt = luxon.DateTime.invalid("Error parsing UTC start/end");
        previewCopy._endDt = luxon.DateTime.invalid("Error parsing UTC start/end");
      }
    } else {
      try {
        const sTime = previewCopy.time || "00:00";
        const eTime = previewCopy.endTime || sTime;
        const sDate = previewCopy.start;
        const eDate = previewCopy.end || sDate;
        const sZone = previewCopy.startTimezone || displayZone;
        const eZone = previewCopy.endTimezone || displayZone;
        const tempStart = luxon.DateTime.fromISO(sDate + "T" + sTime, { zone: sZone });
        previewCopy._startDt = tempStart.isValid ? tempStart.toUTC() : luxon.DateTime.invalid("invalid start parts for preview fallback");
        let tempEnd;
        if (previewCopy.endTime || previewCopy.end) {
          tempEnd = luxon.DateTime.fromISO(eDate + "T" + eTime, { zone: eZone });
        } else if (tempStart.isValid) {
          tempEnd = tempStart.plus({ hours: 1 });
        } else {
          tempEnd = luxon.DateTime.invalid("cannot determine end due to invalid start");
        }
        previewCopy._endDt = tempEnd && tempEnd.isValid ? tempEnd.toUTC() : luxon.DateTime.invalid("invalid end parts for preview fallback");
      } catch (e) {
        previewCopy._startDt = luxon.DateTime.invalid("Error in timed fallback");
        previewCopy._endDt = luxon.DateTime.invalid("Error in timed fallback");
      }
    }
  }
  if (!previewCopy._startDt || !previewCopy._startDt.isValid) previewCopy._startDt = luxon.DateTime.invalid("preview start invalid final check");
  if (!previewCopy._endDt || !previewCopy._endDt.isValid) previewCopy._endDt = luxon.DateTime.invalid("preview end invalid final check");
  if (previewCopy._startDt.isValid && previewCopy._endDt.isValid && previewCopy._endDt < previewCopy._startDt) {
    previewCopy._endDt = previewCopy._startDt.plus({ hours: 1 });
  }
  return previewCopy;
}

function _buildRenderedEventLevelsCache(currentView, resizedEventOriginalId, visibleContextElements) {
  const cache = new Map();
  const eventSelector = currentView === "week" && originalResizedEvent && !originalResizedEvent._isAllDay ? null : currentView === "week" && originalResizedEvent && originalResizedEvent._isAllDay ? `.week-all-day-event-segment[data-event-id][data-level]` : `.event-overlay[data-event-id][data-level]`;

  if (!eventSelector) return cache;

  visibleContextElements.forEach((contextElement) => {
    contextElement.querySelectorAll(eventSelector).forEach((el) => {
      if (el.dataset.eventId !== resizedEventOriginalId && !cache.has(el.dataset.eventId)) {
        cache.set(el.dataset.eventId, parseInt(el.dataset.level, 10));
      }
    });
  });
  return cache;
}

function _findLevelForPreviewSegment(previewSegmentData, otherCommittedEvents, renderedEventLevelsCache, viewConfig) {
  const maxLevels = viewConfig.maxPlacementLevels;
  const displayZone = viewConfig.displayZone;

  if (!previewSegmentData.segmentStartDt.isValid || !previewSegmentData.segmentEndDt.isValid) {
    return maxLevels;
  }
  const segmentStart = previewSegmentData.segmentStartDt.setZone(displayZone);
  const segmentEnd = previewSegmentData.segmentEndDt.setZone(displayZone);

  for (let level = 0; level < maxLevels; level++) {
    let levelIsFree = true;
    for (let dayIter = segmentStart.startOf("day"); dayIter <= segmentEnd.startOf("day"); dayIter = dayIter.plus({ days: 1 })) {
      let dayOccupiedOnThisLevel = false;
      for (const otherEvent of otherCommittedEvents) {
        if (!otherEvent._startDt || !otherEvent._startDt.isValid || !otherEvent._endDt || !otherEvent._endDt.isValid) continue;

        const otherEventActualLevel = renderedEventLevelsCache.get(otherEvent.id);
        if (otherEventActualLevel === undefined || otherEventActualLevel !== level) continue;

        const otherStart = otherEvent._startDt.setZone(displayZone);
        let otherVisualEnd = otherEvent._endDt.setZone(displayZone);
        if (otherEvent._isAllDay) otherVisualEnd = otherVisualEnd.startOf("day");
        else {
          if (otherVisualEnd.hour === 0 && otherVisualEnd.minute === 0 && otherVisualEnd.second === 0 && !otherStart.hasSame(otherVisualEnd, "day")) otherVisualEnd = otherVisualEnd.minus({ days: 1 }).startOf("day");
          else otherVisualEnd = otherVisualEnd.startOf("day");
        }
        if (otherVisualEnd < otherStart.startOf("day")) otherVisualEnd = otherStart.startOf("day");

        if (dayIter >= otherStart.startOf("day") && dayIter <= otherVisualEnd) {
          if (previewSegmentData._isAllDay || otherEvent._isAllDay) {
            dayOccupiedOnThisLevel = true;
            break;
          } else {
            const effectivePreviewSegStart = luxon.DateTime.max(segmentStart, dayIter.startOf("day"));
            const effectivePreviewSegEnd = luxon.DateTime.min(segmentEnd, dayIter.endOf("day"));
            if (!effectivePreviewSegStart.isValid || !effectivePreviewSegEnd.isValid || effectivePreviewSegStart >= effectivePreviewSegEnd) continue;
            const previewIntervalOnDay = luxon.Interval.fromDateTimes(effectivePreviewSegStart, effectivePreviewSegEnd);

            const effectiveOtherStart = luxon.DateTime.max(otherStart, dayIter.startOf("day"));
            const effectiveOtherEnd = luxon.DateTime.min(otherEvent._endDt.setZone(displayZone), dayIter.endOf("day"));
            if (!effectiveOtherStart.isValid || !effectiveOtherEnd.isValid || effectiveOtherStart >= effectiveOtherEnd) continue;
            const otherIntervalOnDay = luxon.Interval.fromDateTimes(effectiveOtherStart, effectiveOtherEnd);

            if (previewIntervalOnDay.isValid && otherIntervalOnDay.isValid && previewIntervalOnDay.overlaps(otherIntervalOnDay) && previewIntervalOnDay.length("milliseconds") > 0 && otherIntervalOnDay.length("milliseconds") > 0) {
              dayOccupiedOnThisLevel = true;
              break;
            }
          }
        }
      }
      if (dayOccupiedOnThisLevel) {
        levelIsFree = false;
        break;
      }
    }
    if (levelIsFree) return level;
  }
  return maxLevels;
}

function renderMonthYearResizePreview(previewEventData, viewConfigForPreview) {
  const eventDataWithLuxonDts = prepareLuxonDtsForPreview(previewEventData, viewConfigForPreview.displayZone);
  if (!eventDataWithLuxonDts._startDt.isValid || !eventDataWithLuxonDts._endDt.isValid) return;

  const overallEventVisualStart = eventDataWithLuxonDts._startDt.setZone(viewConfigForPreview.displayZone);
  let overallEventVisualEnd = eventDataWithLuxonDts._endDt.setZone(viewConfigForPreview.displayZone);
  if (eventDataWithLuxonDts._isAllDay) overallEventVisualEnd = overallEventVisualEnd.startOf("day");
  else {
    if (overallEventVisualEnd.hour === 0 && overallEventVisualEnd.minute === 0 && overallEventVisualEnd.second === 0 && !overallEventVisualStart.hasSame(overallEventVisualEnd, "day")) overallEventVisualEnd = overallEventVisualEnd.minus({ days: 1 }).startOf("day");
    else overallEventVisualEnd = overallEventVisualEnd.startOf("day");
  }
  if (overallEventVisualEnd < overallEventVisualStart.startOf("day")) overallEventVisualEnd = overallEventVisualStart.startOf("day");

  const fullOtherEventsCache = originalResizedEvent._otherEventsCache || [];
  const renderedEventLevels = originalResizedEvent._renderedEventLevelsCache || new Map();
  let anySegmentHidden = false;

  document.querySelectorAll(".month-card").forEach((monthCard) => {
    const calendarGrid = monthCard.querySelector(".calendar-grid");
    if (!calendarGrid) return;
    const dayElementsInCard = Array.from(calendarGrid.querySelectorAll(".day:not(.empty-day)[data-date]"));
    if (dayElementsInCard.length === 0) return;
    const cardId = monthCard.id;
    const currentCardCellCache = monthCardGeometryCaches.get(cardId);
    if (!currentCardCellCache || currentCardCellCache.size === 0) return;

    const firstDayInGridDt = luxon.DateTime.fromISO(dayElementsInCard[0].dataset.date, { zone: viewConfigForPreview.displayZone }).startOf("day");
    const lastDayInGridDt = luxon.DateTime.fromISO(dayElementsInCard[dayElementsInCard.length - 1].dataset.date, { zone: viewConfigForPreview.displayZone }).endOf("day");

    const cardSpecificOtherEvents = fullOtherEventsCache.filter((other) => {
      if (!other._startDt.isValid || !other._endDt.isValid) return false;
      const otherStart = other._startDt.setZone(viewConfigForPreview.displayZone);
      const otherEnd = other._endDt.setZone(viewConfigForPreview.displayZone);
      return luxon.Interval.fromDateTimes(firstDayInGridDt, lastDayInGridDt).overlaps(luxon.Interval.fromDateTimes(otherStart, otherEnd));
    });

    const cardRenderStartDt = luxon.DateTime.max(overallEventVisualStart.startOf("day"), firstDayInGridDt);
    const cardRenderEndDt = luxon.DateTime.min(overallEventVisualEnd.startOf("day"), lastDayInGridDt);
    if (cardRenderStartDt > cardRenderEndDt) return;

    const firstDayOfMonthDateObj = luxon.DateTime.local(firstDayInGridDt.year, firstDayInGridDt.month, 1, { zone: viewConfigForPreview.displayZone });
    let startOffsetInGrid = firstDayOfMonthDateObj.weekday - 1;
    if (startOffsetInGrid < 0) startOffsetInGrid = 6;

    let currentProcessingDay = cardRenderStartDt;
    while (currentProcessingDay <= cardRenderEndDt) {
      const segmentStartDate = currentProcessingDay;
      const endOfWeekForSegment = currentProcessingDay.endOf("week");
      const segmentEndDate = luxon.DateTime.min(cardRenderEndDt, endOfWeekForSegment, overallEventVisualEnd.startOf("day"));

      const segmentDataForLevelFinding = {
        segmentStartDt: segmentStartDate,
        segmentEndDt: segmentEndDate,
        _isAllDay: eventDataWithLuxonDts._isAllDay,
        id: eventDataWithLuxonDts.id,
      };
      const segmentTargetLevel = _findLevelForPreviewSegment(segmentDataForLevelFinding, cardSpecificOtherEvents, renderedEventLevels, viewConfigForPreview);
      if (segmentTargetLevel >= viewConfigForPreview.maxPlacementLevels) anySegmentHidden = true;

      const previewSegmentDiv = createEventSegmentElement(eventDataWithLuxonDts, segmentStartDate, segmentEndDate, overallEventVisualEnd.startOf("day"), currentCardCellCache, startOffsetInGrid, segmentTargetLevel, viewConfigForPreview, true);
      if (previewSegmentDiv) {
        if (previewEventData._isOverallCollidingPreview || anySegmentHidden) previewSegmentDiv.classList.add(COLLIDING_PREVIEW_CLASS);
        monthCard.appendChild(previewSegmentDiv);
      }
      currentProcessingDay = segmentEndDate.plus({ days: 1 });
    }
  });
  if (previewEventData) previewEventData._isOverallCollidingPreview = anySegmentHidden;
}

function renderWeekViewResizePreview(previewEventData, viewConfigForPreview) {
  const eventData = prepareLuxonDtsForPreview(previewEventData, viewConfigForPreview.displayZone);
  if (!eventData._startDt.isValid || !eventData._endDt.isValid) {
    return;
  }

  const overallEventVisualStart = eventData._startDt.setZone(viewConfigForPreview.displayZone);
  let overallEventVisualEnd = eventData._endDt.setZone(viewConfigForPreview.displayZone);
  if (eventData._isAllDay) overallEventVisualEnd = overallEventVisualEnd.startOf("day");

  const weekDayColumns = activeResizeOperationCache.allDayColumns.map((colData) => colData.element); // Use cached elements
  if (weekDayColumns.length !== 7) {
    // Should still check, though cache should be reliable
    // Fallback if cache somehow failed (should not happen if mousedown populates it)
    const freshCols = Array.from(document.querySelectorAll(".week-day-column[data-date]"));
    if (freshCols.length === 7) weekDayColumns.splice(0, weekDayColumns.length, ...freshCols);
    else return;
  }
  const weekViewStartDt = luxon.DateTime.fromISO(weekDayColumns[0].dataset.date, { zone: viewConfigForPreview.displayZone });

  let isOverallColliding = previewEventData._isOverallCollidingPreview || false;

  if (eventData._isAllDay) {
    const allDayRow = document.querySelector(".week-all-day-row");
    if (!allDayRow) return;

    const weekSpecificOtherEvents = (originalResizedEvent._otherEventsCache || []).filter((e) => e._isAllDay && e._startDt.isValid && e._endDt.isValid && e._startDt.setZone(viewConfigForPreview.displayZone) < weekViewStartDt.endOf("week") && e._endDt.setZone(viewConfigForPreview.displayZone) >= weekViewStartDt.startOf("week"));
    const renderedEventLevels = originalResizedEvent._renderedEventLevelsCache || new Map();

    let currentProcessingDay = luxon.DateTime.max(overallEventVisualStart.startOf("day"), weekViewStartDt.startOf("week"));
    const weekActualEnd = luxon.DateTime.min(overallEventVisualEnd.startOf("day"), weekViewStartDt.endOf("week"));

    if (currentProcessingDay.isValid && weekActualEnd.isValid && currentProcessingDay <= weekActualEnd) {
      const segmentStartDate = currentProcessingDay;
      const segmentEndDate = weekActualEnd;
      const segmentDataForLevelFinding = {
        segmentStartDt: segmentStartDate,
        segmentEndDt: segmentEndDate,
        _isAllDay: true,
        id: eventData.id,
      };
      const segmentTargetLevel = _findLevelForPreviewSegment(segmentDataForLevelFinding, weekSpecificOtherEvents, renderedEventLevels, viewConfigForPreview);
      if (segmentTargetLevel >= viewConfigForPreview.maxPlacementLevels) isOverallColliding = true;

      let segmentStartDayIndex = -1;
      for (let i = 0; i < 7; i++) {
        const dayInGrid = weekViewStartDt.plus({ days: i });
        if (dayInGrid >= segmentStartDate && dayInGrid <= segmentEndDate) {
          if (segmentStartDayIndex === -1) segmentStartDayIndex = i;
          if (i === 6 || dayInGrid.equals(segmentEndDate)) {
            const numDaysInDisplaySegment = i - segmentStartDayIndex + 1;
            const firstSlotOfDisplaySegment = allDayRow.querySelector(`.week-all-day-slot[data-date="${weekViewStartDt.plus({ days: segmentStartDayIndex }).toFormat("yyyy-MM-dd")}"]`);
            if (firstSlotOfDisplaySegment) {
              const previewBlock = document.createElement("div");
              previewBlock.className = PREVIEW_SEGMENT_CLASS;
              if (isOverallColliding) previewBlock.classList.add(COLLIDING_PREVIEW_CLASS);
              previewBlock.style.backgroundColor = eventData.color ? `${eventData.color}99` : `rgba(59, 130, 246, 0.6)`;
              previewBlock.style.position = "absolute";
              previewBlock.style.top = `${segmentTargetLevel * (viewConfigForPreview.overlayHeight + viewConfigForPreview.verticalSpacing)}px`;
              previewBlock.style.height = `${viewConfigForPreview.overlayHeight}px`;
              const slotWidth = firstSlotOfDisplaySegment.offsetWidth;
              previewBlock.style.left = `${firstSlotOfDisplaySegment.offsetLeft}px`;
              previewBlock.style.width = `${numDaysInDisplaySegment * slotWidth - (numDaysInDisplaySegment > 1 ? 2 : 0)}px`;
              previewBlock.textContent = eventData.name;
              allDayRow.appendChild(previewBlock);
            }
            break;
          }
        }
      }
    }
  } else {
    isOverallColliding = checkBasicResizePreviewCollision(eventData, resizedEventId, "week", viewConfigForPreview.displayZone);
    for (let i = 0; i < 7; i++) {
      const currentColumnDay = weekViewStartDt.plus({ days: i });
      const dayColumn = weekDayColumns[i];
      if (!eventData._startDt.isValid || !eventData._endDt.isValid) continue;

      const eventIntervalUtc = luxon.Interval.fromDateTimes(eventData._startDt, eventData._endDt);
      if (!eventIntervalUtc.isValid) continue;

      const columnDayIntervalUtc = luxon.Interval.fromDateTimes(currentColumnDay.startOf("day").toUTC(), currentColumnDay.endOf("day").toUTC());
      if (!eventIntervalUtc.overlaps(columnDayIntervalUtc)) continue;

      const startDisp = eventData._startDt.setZone(viewConfigForPreview.displayZone);
      const endDisp = eventData._endDt.setZone(viewConfigForPreview.displayZone);
      let eventStartHourFraction = 0;
      if (startDisp.hasSame(currentColumnDay, "day")) eventStartHourFraction = startDisp.hour + startDisp.minute / 60;
      let eventEndHourFraction = 24;
      if (endDisp.hasSame(currentColumnDay, "day")) {
        eventEndHourFraction = endDisp.hour + endDisp.minute / 60;
        if (eventEndHourFraction === 0 && startDisp.hasSame(endDisp, "day")) continue;
      }
      if (eventEndHourFraction === 0 && endDisp.startOf("day").equals(currentColumnDay.plus({ days: 1 })) && !startDisp.hasSame(endDisp, "day")) {
        // Ends at midnight of the next day, so fills current day
      } else if (eventEndHourFraction === 0 && endDisp.startOf("day").equals(currentColumnDay) && !startDisp.hasSame(endDisp, "day")) {
        continue;
      }

      if (eventEndHourFraction <= eventStartHourFraction && startDisp.hasSame(endDisp, "day")) {
        if (startDisp.equals(endDisp)) continue;
        eventEndHourFraction = eventStartHourFraction + 15 / 60;
      }

      const top = eventStartHourFraction * HOUR_HEIGHT_IN_WEEK_VIEW;
      let height = (eventEndHourFraction - eventStartHourFraction) * HOUR_HEIGHT_IN_WEEK_VIEW;

      if (height <= 1 && height > 0) height = HOUR_HEIGHT_IN_WEEK_VIEW / 4;
      if (height <= 0) continue;

      const previewBlock = document.createElement("div");
      previewBlock.className = WEEK_RESIZE_PREVIEW_CLASS;
      if (isOverallColliding) previewBlock.classList.add(COLLIDING_PREVIEW_CLASS);
      previewBlock.style.backgroundColor = eventData.color ? `${eventData.color}99` : `rgba(59, 130, 246, 0.6)`;
      previewBlock.style.top = `${top}px`;
      previewBlock.style.height = `${height}px`;
      previewBlock.style.left = `0%`;
      previewBlock.style.width = `calc(100% - 4px)`;
      previewBlock.style.marginLeft = `2px`;
      if (currentColumnDay.hasSame(startDisp, "day")) previewBlock.textContent = `${eventData.name}`;
      dayColumn.appendChild(previewBlock);
    }
  }
  if (previewEventData) previewEventData._isOverallCollidingPreview = isOverallColliding;
}

function renderResizePreview(previewEventData) {
  clearResizePreview();
  const displayZone = resizeCurrentViewAppZone; // Use cached app zone

  const viewConfigForPreview = {
    viewName: activeResizeOperationCache.currentView, // Use cached view
    overlayHeight: activeResizeOperationCache.currentView === "year" ? 5 : activeResizeOperationCache.currentView === "month" ? 18 : 18,
    verticalSpacing: activeResizeOperationCache.currentView === "year" ? 1 : activeResizeOperationCache.currentView === "month" ? 3 : 2,
    maxPlacementLevels: activeResizeOperationCache.currentView === "year" ? 3 : 3,
    displayZone: displayZone,
    hourHeightPx: HOUR_HEIGHT_IN_WEEK_VIEW,
  };

  if (activeResizeOperationCache.currentView === "month" || activeResizeOperationCache.currentView === "year") {
    if (typeof window.createEventSegmentElement !== "function") return;
    renderMonthYearResizePreview(previewEventData, viewConfigForPreview);
  } else if (activeResizeOperationCache.currentView === "week") {
    renderWeekViewResizePreview(previewEventData, viewConfigForPreview);
  }
}

function calculateResizedEventProperties(originalEvent, newTargetInfo, resizeMode, currentView, appZone) {
  const updatedEvent = { ...originalEvent };
  const isOriginalAllDay = typeof originalEvent._isAllDay === "boolean" ? originalEvent._isAllDay : !originalEvent.start_utc;
  const originalStartTimezone = originalEvent.startTimezone || appZone;
  const originalEndTimezone = originalEvent.endTimezone || appZone;

  if (currentView === "week" && !isOriginalAllDay && (resizeMode === "top" || resizeMode === "bottom")) {
    const targetDateStr = newTargetInfo.dateString;
    let targetHour = newTargetInfo.hour;
    const targetMinute = newTargetInfo.minute || 0;
    let newStartLocal, newEndLocal;

    const originalStartDt = originalEvent._startDt && originalEvent._startDt.isValid ? originalEvent._startDt : luxon.DateTime.fromISO(originalEvent.start_utc, { zone: "utc" });
    const originalEndDt = originalEvent._endDt && originalEvent._endDt.isValid ? originalEvent._endDt : luxon.DateTime.fromISO(originalEvent.end_utc, { zone: "utc" });

    if (!originalStartDt.isValid || !originalEndDt.isValid) {
      console.warn("Week timed resize: Invalid original Luxon dates.");
      return updatedEvent;
    }

    if (resizeMode === "top") {
      newStartLocal = luxon.DateTime.fromISO(targetDateStr, { zone: originalStartTimezone }).set({ hour: targetHour, minute: targetMinute });
      newEndLocal = originalEndDt.setZone(originalEndTimezone);
      if (newStartLocal.isValid && newEndLocal.isValid && newStartLocal.toUTC() >= newEndLocal.toUTC()) {
        newEndLocal = newStartLocal.setZone(originalEndTimezone).plus({ hours: 1 });
      }
    } else {
      // resizeMode === "bottom"
      newStartLocal = originalStartDt.setZone(originalStartTimezone);
      if (typeof newTargetInfo.minute === "number" && newTargetInfo.minute !== 0) {
        newEndLocal = luxon.DateTime.fromISO(targetDateStr, { zone: originalEndTimezone }).set({ hour: targetHour, minute: targetMinute });
      } else {
        newEndLocal = luxon.DateTime.fromISO(targetDateStr, { zone: originalEndTimezone }).set({ hour: targetHour, minute: 0 }).plus({ hours: 1 });
      }
      if (newStartLocal.isValid && newEndLocal.isValid && newEndLocal.toUTC() <= newStartLocal.toUTC()) {
        newEndLocal = newStartLocal.setZone(originalEndTimezone).plus({ minutes: 15 });
      }
    }
    if (newStartLocal && newStartLocal.isValid) {
      updatedEvent.start = newStartLocal.toFormat("yyyy-MM-dd");
      updatedEvent.time = newStartLocal.toFormat("HH:mm");
      updatedEvent.start_utc = newStartLocal.toUTC().toISO();
      updatedEvent.startTimezone = originalStartTimezone;
    }
    if (newEndLocal && newEndLocal.isValid) {
      updatedEvent.end = newEndLocal.toFormat("yyyy-MM-dd");
      updatedEvent.endTime = newEndLocal.toFormat("HH:mm");
      updatedEvent.end_utc = newEndLocal.toUTC().toISO();
      updatedEvent.endTimezone = originalEndTimezone;
    }
  } else {
    // All-Day events in any view, OR Timed events in Month/Year view (date-handle resize)
    const newDateCellString = newTargetInfo.dateString;
    const newTargetDayOnlyDt = luxon.DateTime.fromISO(newDateCellString, { zone: appZone }).startOf("day");

    if (isOriginalAllDay) {
      let currentStartDt = luxon.DateTime.fromISO(originalEvent.start, { zone: appZone }).startOf("day");
      let currentEndDt = luxon.DateTime.fromISO(originalEvent.end, { zone: appZone }).startOf("day");
      if (resizeMode === "start") {
        currentStartDt = newTargetDayOnlyDt;
        if (currentStartDt.isValid && currentEndDt.isValid && currentStartDt > currentEndDt) {
          currentEndDt = currentStartDt;
        }
      } else {
        // resizeMode === "end"
        currentEndDt = newTargetDayOnlyDt;
        if (currentStartDt.isValid && currentEndDt.isValid && currentEndDt < currentStartDt) {
          currentStartDt = currentEndDt;
        }
      }
      if (currentStartDt.isValid) updatedEvent.start = currentStartDt.toFormat("yyyy-MM-dd");
      if (currentEndDt.isValid) updatedEvent.end = currentEndDt.toFormat("yyyy-MM-dd");
      delete updatedEvent.time;
      delete updatedEvent.endTime;
      delete updatedEvent.start_utc;
      delete updatedEvent.end_utc;
      delete updatedEvent.startTimezone;
      delete updatedEvent.endTimezone;
    } else {
      // Timed event, date-handle resize (Month/Year view or similar)
      const origStartStr = originalEvent.time || "00:00";
      const origEndStr = originalEvent.endTime || "00:00"; // Should exist for well-formed timed events

      const newTargetDateLuxon = luxon.DateTime.fromISO(newTargetInfo.dateString, { zone: appZone }).startOf("day");

      let finalEffectiveStartDate = luxon.DateTime.fromISO(originalEvent.start, { zone: appZone }).startOf("day");
      let finalEffectiveEndDate = luxon.DateTime.fromISO(originalEvent.end, { zone: appZone }).startOf("day");

      if (resizeMode === "start") {
        const newStartDateCandidate = newTargetDateLuxon;
        if (newStartDateCandidate.toMillis() > finalEffectiveEndDate.toMillis()) {
          finalEffectiveEndDate = newStartDateCandidate;
        }
        finalEffectiveStartDate = newStartDateCandidate;
      } else {
        // resizeMode === "end"
        const newEndDateCandidate = newTargetDateLuxon;
        if (newEndDateCandidate.toMillis() < finalEffectiveStartDate.toMillis()) {
          finalEffectiveStartDate = newEndDateCandidate;
        }
        finalEffectiveEndDate = newEndDateCandidate;
      }

      const [sH, sM] = origStartStr.split(":").map(Number);
      const [eH, eM] = origEndStr.split(":").map(Number);

      let finalNewStartLocal = finalEffectiveStartDate.setZone(originalEvent.startTimezone || appZone).set({ hour: sH, minute: sM });

      let finalNewEndLocal = finalEffectiveEndDate.setZone(originalEvent.endTimezone || appZone).set({ hour: eH, minute: eM });

      if (finalNewStartLocal.toUTC() >= finalNewEndLocal.toUTC()) {
        finalNewEndLocal = finalNewEndLocal.plus({ days: 1 });
      }

      if (finalNewStartLocal && finalNewStartLocal.isValid) {
        updatedEvent.start = finalNewStartLocal.toFormat("yyyy-MM-dd");
        updatedEvent.time = finalNewStartLocal.toFormat("HH:mm");
        updatedEvent.start_utc = finalNewStartLocal.toUTC().toISO();
        updatedEvent.startTimezone = originalEvent.startTimezone || appZone;
      }
      if (finalNewEndLocal && finalNewEndLocal.isValid) {
        updatedEvent.end = finalNewEndLocal.toFormat("yyyy-MM-dd");
        updatedEvent.endTime = finalNewEndLocal.toFormat("HH:mm");
        updatedEvent.end_utc = finalNewEndLocal.toUTC().toISO();
        updatedEvent.endTimezone = originalEvent.endTimezone || appZone;
      }
    }
  }
  return updatedEvent;
}

function checkBasicResizePreviewCollision(previewEventData, resizedEventOriginalId, currentView, appDisplayZone) {
  if (currentView !== "week" || previewEventData._isAllDay) return false;
  if (!previewEventData._startDt || !previewEventData._startDt.isValid || !previewEventData._endDt || !previewEventData._endDt.isValid) return false;

  const previewStart = previewEventData._startDt.setZone(appDisplayZone);
  const previewEnd = previewEventData._endDt.setZone(appDisplayZone);

  const otherEvents = (originalResizedEvent?._otherEventsCache || []).filter((e) => !e._isAllDay && e.start_utc && e.end_utc);

  let iterEndDayTimed = previewEnd.minus({ seconds: 1 }).startOf("day");
  if (previewEnd.hour === 0 && previewEnd.minute === 0 && previewEnd.second === 0 && !previewStart.hasSame(previewEnd, "day")) {
    iterEndDayTimed = previewEnd.minus({ days: 1 }).startOf("day");
  }

  for (let dayIter = previewStart.startOf("day"); dayIter <= iterEndDayTimed; dayIter = dayIter.plus({ days: 1 })) {
    const effectivePreviewStart = luxon.DateTime.max(previewStart, dayIter.startOf("day"));
    const effectivePreviewEnd = luxon.DateTime.min(previewEnd, dayIter.endOf("day"));
    if (!effectivePreviewStart.isValid || !effectivePreviewEnd.isValid || effectivePreviewStart >= effectivePreviewEnd) continue;
    const previewIntervalOnDay = luxon.Interval.fromDateTimes(effectivePreviewStart, effectivePreviewEnd);

    for (const otherEvent of otherEvents) {
      if (!otherEvent._startDt.isValid || !otherEvent._endDt.isValid) continue;
      const otherStart = otherEvent._startDt.setZone(appDisplayZone);
      const otherEnd = otherEvent._endDt.setZone(appDisplayZone);

      const effectiveOtherStart = luxon.DateTime.max(otherStart, dayIter.startOf("day"));
      const effectiveOtherEnd = luxon.DateTime.min(otherEnd, dayIter.endOf("day"));
      if (!effectiveOtherStart.isValid || !effectiveOtherEnd.isValid || effectiveOtherStart >= effectiveOtherEnd) continue;
      const otherIntervalOnDay = luxon.Interval.fromDateTimes(effectiveOtherStart, effectiveOtherEnd);

      if (previewIntervalOnDay.isValid && otherIntervalOnDay.isValid && previewIntervalOnDay.overlaps(otherIntervalOnDay) && previewIntervalOnDay.length("milliseconds") > 0 && otherIntervalOnDay.length("milliseconds") > 0) {
        return true;
      }
    }
  }
  return false;
}

function getElementUnderCursorIgnoringPreviews(clientX, clientY) {
  const previewSelectors = [`.${PREVIEW_SEGMENT_CLASS}`, `.${WEEK_RESIZE_PREVIEW_CLASS}`];
  let element = document.elementFromPoint(clientX, clientY);
  const hiddenElements = [];
  let depth = 0;

  while (element && previewSelectors.some((sel) => element.matches(sel)) && depth < 5) {
    hiddenElements.push({ el: element, display: element.style.display });
    element.style.display = "none";
    element = document.elementFromPoint(clientX, clientY);
    depth++;
  }

  for (let i = hiddenElements.length - 1; i >= 0; i--) {
    hiddenElements[i].el.style.display = hiddenElements[i].display;
  }
  return element;
}

function handleMouseDownOnOverlay(event) {
  if (event.button !== 0 || window.calendarInteractionState.isResizing || document.body.classList.contains("is-dragging-active")) return;
  const overlay = event.target.closest(".event-overlay, .week-event-block, .week-all-day-event-segment");
  if (!overlay) return;

  const eventId = overlay.dataset.eventId;
  const currentEventData = customEvents.find((e) => e.id === eventId);
  if (!currentEventData) return;

  const eventDataForResizeInit = currentEventData._startDt && currentEventData._endDt && currentEventData._startDt.isValid && currentEventData._endDt.isValid ? { ...currentEventData } : prepareLuxonDtsForPreview({ ...currentEventData }, luxon.DateTime.local().zoneName);

  if (!eventDataForResizeInit._startDt || !eventDataForResizeInit._startDt.isValid || !eventDataForResizeInit._endDt || !eventDataForResizeInit._endDt.isValid) {
    return;
  }

  const rect = overlay.getBoundingClientRect();
  const offsetX = event.clientX - rect.left;
  const offsetY = event.clientY - rect.top;
  const overlayWidth = overlay.offsetWidth;
  const overlayHeight = overlay.offsetHeight;
  let localResizeMode = null;
  const currentViewValue = viewSelect.value; // Get view once
  const isEventBeingResizedAllDay = eventDataForResizeInit._isAllDay;

  if (currentViewValue === "week" && overlay.classList.contains("week-event-block") && !isEventBeingResizedAllDay) {
    if (offsetY < RESIZE_HANDLE_WIDTH_PX) localResizeMode = "top";
    else if (offsetY > overlayHeight - RESIZE_HANDLE_WIDTH_PX) localResizeMode = "bottom";
  } else if (overlay.classList.contains("event-overlay") || overlay.classList.contains("week-all-day-event-segment")) {
    const isTrueStartVisualSegment = overlay.classList.contains("event-overlay-start") || overlay.classList.contains("week-all-day-event-segment");
    const isTrueEndVisualSegment = overlay.classList.contains("event-overlay-end") || overlay.classList.contains("week-all-day-event-segment");
    let handleThreshold = RESIZE_HANDLE_WIDTH_PX;
    if ((currentViewValue === "month" || currentViewValue === "year") && !isEventBeingResizedAllDay) {
      if (overlayWidth < RESIZE_HANDLE_WIDTH_PX * 3 && overlayWidth > 0) handleThreshold = Math.max(overlayWidth / 2.5, 5);
    }
    if (isTrueEndVisualSegment && offsetX > overlayWidth - handleThreshold) localResizeMode = "end";
    else if (isTrueStartVisualSegment && offsetX < handleThreshold) localResizeMode = "start";
  }

  if (localResizeMode) {
    event.preventDefault();
    event.stopPropagation();
    window.calendarInteractionState.isResizing = true;
    resizeMode = localResizeMode;
    resizedEventId = eventId;
    originalResizedEvent = JSON.parse(JSON.stringify(eventDataForResizeInit));
    originalResizedEvent._startDt = eventDataForResizeInit._startDt;
    originalResizedEvent._endDt = eventDataForResizeInit._endDt;
    originalResizedEvent._isAllDay = eventDataForResizeInit._isAllDay;

    resizeCurrentViewAppZone = luxon.DateTime.local().zoneName;
    lastValidResizeTargetInfo = null;
    currentHoverTargetElement = null;
    lastPreviewRecalculationTargetKey = null;

    // Populate activeResizeOperationCache
    activeResizeOperationCache.currentView = currentViewValue;
    if (currentViewValue === "week") {
      activeResizeOperationCache.daysContainer = document.querySelector(".week-days-container");
      if (activeResizeOperationCache.daysContainer) {
        activeResizeOperationCache.allDayColumns = Array.from(activeResizeOperationCache.daysContainer.querySelectorAll(".week-day-column[data-date]")).map((col) => ({ element: col, rect: col.getBoundingClientRect() }));
      } else {
        activeResizeOperationCache.allDayColumns = [];
      }
    } else {
      activeResizeOperationCache.daysContainer = null;
      activeResizeOperationCache.allDayColumns = [];
    }

    const levelString = overlay.dataset.level;
    resizeInitialLevel = levelString !== undefined ? parseInt(levelString, 10) : 0;
    if (isNaN(resizeInitialLevel)) resizeInitialLevel = 0;

    originalResizedEvent._otherEventsCache = customEvents
      .filter((e) => e.id !== originalResizedEvent.id)
      .map((e) => {
        const prepared = e._startDt && e._endDt && e._startDt.isValid && e._endDt.isValid ? { ...e } : prepareLuxonDtsForPreview({ ...e }, resizeCurrentViewAppZone);
        return prepared._startDt && prepared._startDt.isValid && prepared._endDt && prepared._endDt.isValid ? prepared : null;
      })
      .filter(Boolean);

    let visibleContexts = [];
    if (activeResizeOperationCache.currentView === "month" || activeResizeOperationCache.currentView === "year" || (activeResizeOperationCache.currentView === "week" && originalResizedEvent._isAllDay)) {
      if (activeResizeOperationCache.currentView === "month" || activeResizeOperationCache.currentView === "year") {
        visibleContexts = Array.from(document.querySelectorAll(".month-card"));
      } else {
        const allDayRow = document.querySelector(".week-all-day-row");
        if (allDayRow) visibleContexts = [allDayRow];
      }
      originalResizedEvent._renderedEventLevelsCache = _buildRenderedEventLevelsCache(activeResizeOperationCache.currentView, resizedEventId, visibleContexts);
    } else {
      originalResizedEvent._renderedEventLevelsCache = new Map();
    }

    document.querySelectorAll(".event-overlay, .week-event-block, .week-all-day-event-segment").forEach((o) => {
      if (o.dataset.eventId !== resizedEventId) o.classList.add(RESIZE_OBSTRUCTING_IGNORE_CLASS);
    });
    document.querySelectorAll(`.event-overlay[data-event-id="${resizedEventId}"], .week-event-block[data-event-id="${resizedEventId}"], .week-all-day-event-segment[data-event-id="${resizedEventId}"]`).forEach((seg) => seg.classList.add(RESIZING_ORIGINAL_HIDDEN_CLASS));

    const initialPreviewData = { ...originalResizedEvent, _isOverallCollidingPreview: false };
    throttledRenderPreview(initialPreviewData);

    document.addEventListener("mousemove", handleDocumentMouseMove);
    document.addEventListener("mouseup", handleDocumentMouseUp, { once: true });
    document.body.classList.add("is-resizing-active");
    document.body.style.cursor = resizeMode === "top" || resizeMode === "bottom" ? "ns-resize" : "ew-resize";
  }
}

function handleDocumentMouseMove(event) {
  if (!window.calendarInteractionState.isResizing || !originalResizedEvent) return;
  event.preventDefault();

  let potentialTargetInfo = null;
  let newHoverElement = null;
  let currentTargetKey = null;

  const isOriginalTimed = originalResizedEvent && !originalResizedEvent._isAllDay;
  const hasValidOriginalDates = originalResizedEvent && originalResizedEvent._startDt && originalResizedEvent._startDt.isValid;

  if (activeResizeOperationCache.currentView === "week" && isOriginalTimed && hasValidOriginalDates && (resizeMode === "top" || resizeMode === "bottom")) {
    if (activeResizeOperationCache.daysContainer && activeResizeOperationCache.allDayColumns.length > 0) {
      let targetDayColumnData = null;
      for (const colData of activeResizeOperationCache.allDayColumns) {
        // Use cached rect
        if (event.clientX >= colData.rect.left && event.clientX <= colData.rect.right) {
          targetDayColumnData = colData;
          break;
        }
      }

      if (targetDayColumnData && targetDayColumnData.element.dataset.date) {
        const relativeYInColumn = event.clientY - targetDayColumnData.rect.top; // Use cached rect.top
        let hourIndex = Math.floor(relativeYInColumn / HOUR_HEIGHT_IN_WEEK_VIEW);
        hourIndex = Math.max(0, Math.min(23, hourIndex));

        potentialTargetInfo = {
          dateString: targetDayColumnData.element.dataset.date,
          hour: hourIndex,
        };
        currentTargetKey = `${potentialTargetInfo.dateString}-${potentialTargetInfo.hour}`;
        const targetTimeStr = `${String(hourIndex).padStart(2, "0")}:00`;
        newHoverElement = targetDayColumnData.element.querySelector(`.hour-slot[data-time="${targetTimeStr}"][data-date="${targetDayColumnData.element.dataset.date}"]`) || targetDayColumnData.element;
      }
    }
  } else {
    const tempElement = getElementUnderCursorIgnoringPreviews(event.clientX, event.clientY);
    if (tempElement) {
      newHoverElement = tempElement.closest(".day:not(.empty-day)[data-date], .week-all-day-slot[data-date]");
      if (newHoverElement) {
        potentialTargetInfo = { dateString: newHoverElement.dataset.date };
        currentTargetKey = newHoverElement.dataset.date;
      }
    }
  }

  if (currentHoverTargetElement && currentHoverTargetElement !== newHoverElement) currentHoverTargetElement.classList.remove(RESIZE_TARGET_HOVER_CLASS);
  if (newHoverElement && newHoverElement !== currentHoverTargetElement) newHoverElement.classList.add(RESIZE_TARGET_HOVER_CLASS);
  currentHoverTargetElement = newHoverElement;

  if (potentialTargetInfo) {
    lastValidResizeTargetInfo = potentialTargetInfo;
    const previewEventData = calculateResizedEventProperties(originalResizedEvent, lastValidResizeTargetInfo, resizeMode, activeResizeOperationCache.currentView, resizeCurrentViewAppZone);
    const preparedPreviewData = prepareLuxonDtsForPreview(previewEventData, resizeCurrentViewAppZone);
    preparedPreviewData._isOverallCollidingPreview = false;

    if (currentTargetKey && (currentTargetKey !== lastPreviewRecalculationTargetKey || lastPreviewRecalculationTargetKey === null)) {
      lastPreviewRecalculationTargetKey = currentTargetKey;
      let visibleContexts = [];
      if (activeResizeOperationCache.currentView === "month" || activeResizeOperationCache.currentView === "year" || (activeResizeOperationCache.currentView === "week" && preparedPreviewData._isAllDay)) {
        if (activeResizeOperationCache.currentView === "month" || activeResizeOperationCache.currentView === "year") visibleContexts = Array.from(document.querySelectorAll(".month-card"));
        else {
          const allDayRow = document.querySelector(".week-all-day-row");
          if (allDayRow) visibleContexts = [allDayRow];
        }
        if (originalResizedEvent && visibleContexts.length > 0) originalResizedEvent._renderedEventLevelsCache = _buildRenderedEventLevelsCache(activeResizeOperationCache.currentView, resizedEventId, visibleContexts);
      }
    }
    throttledRenderPreview(preparedPreviewData);
  } else if (lastValidResizeTargetInfo) {
    const previewEventData = calculateResizedEventProperties(originalResizedEvent, lastValidResizeTargetInfo, resizeMode, activeResizeOperationCache.currentView, resizeCurrentViewAppZone);
    const preparedPreviewData = prepareLuxonDtsForPreview(previewEventData, resizeCurrentViewAppZone);
    preparedPreviewData._isOverallCollidingPreview = false;
    throttledRenderPreview(preparedPreviewData);
  }
}

function handleDocumentMouseUp(event) {
  document.removeEventListener("mousemove", handleDocumentMouseMove);
  document.body.classList.remove("is-resizing-active");
  document.body.style.cursor = "";

  if (!window.calendarInteractionState.isResizing || !resizedEventId || !originalResizedEvent) {
    resetResizeState();
    return;
  }
  event.preventDefault();
  resetPointerEventsAndPreview();
  document.querySelectorAll(`.${RESIZING_ORIGINAL_HIDDEN_CLASS}[data-event-id="${resizedEventId}"]`).forEach((seg) => seg.classList.remove(RESIZING_ORIGINAL_HIDDEN_CLASS));

  // Use cached currentView
  const eventToUpdate = customEvents.find((e) => e.id === resizedEventId);

  if (!eventToUpdate) {
    resetResizeState();
    if (typeof window.renderEventVisuals === "function") requestAnimationFrame(window.renderEventVisuals);
    return;
  }

  if (currentHoverTargetElement) currentHoverTargetElement.classList.remove(RESIZE_TARGET_HOVER_CLASS);

  if (!lastValidResizeTargetInfo) {
    resetResizeState();
    if (typeof window.renderEventVisuals === "function") requestAnimationFrame(window.renderEventVisuals);
    return;
  }

  const finalEventProperties = calculateResizedEventProperties(originalResizedEvent, lastValidResizeTargetInfo, resizeMode, activeResizeOperationCache.currentView, resizeCurrentViewAppZone);
  delete finalEventProperties._startDt;
  delete finalEventProperties._endDt;
  delete finalEventProperties._isAllDay;
  delete finalEventProperties._isOverallCollidingPreview;
  delete finalEventProperties._otherEventsCache;
  delete finalEventProperties._renderedEventLevelsCache;

  Object.assign(eventToUpdate, finalEventProperties);

  if (typeof saveEvents === "function") saveEvents();
  resetResizeState(); // This will also clear activeResizeOperationCache
  if (typeof window.renderEventVisuals === "function") requestAnimationFrame(window.renderEventVisuals);
}

function resetPointerEventsAndPreview() {
  clearResizePreview();
  document.querySelectorAll(`.${RESIZE_OBSTRUCTING_IGNORE_CLASS}`).forEach((o) => o.classList.remove(RESIZE_OBSTRUCTING_IGNORE_CLASS));
}

function resetResizeStateOnly() {
  resizeMode = null;
  resizedEventId = null;
  if (originalResizedEvent) {
    delete originalResizedEvent._otherEventsCache;
    delete originalResizedEvent._renderedEventLevelsCache;
  }
  originalResizedEvent = null;
  lastValidResizeTargetInfo = null;
  currentHoverTargetElement = null;
  resizeInitialLevel = 0;
  resizeCurrentViewAppZone = "UTC";
  lastPreviewRecalculationTargetKey = null;

  // Clear the operation cache
  activeResizeOperationCache.currentView = null;
  activeResizeOperationCache.daysContainer = null;
  activeResizeOperationCache.allDayColumns = [];
}

function resetResizeState() {
  resetPointerEventsAndPreview();
  if (window.calendarInteractionState) window.calendarInteractionState.isResizing = false;
  document.querySelectorAll(`.${RESIZING_ORIGINAL_HIDDEN_CLASS}`).forEach((seg) => seg.classList.remove(RESIZING_ORIGINAL_HIDDEN_CLASS));
  if (currentHoverTargetElement) currentHoverTargetElement.classList.remove(RESIZE_TARGET_HOVER_CLASS);

  if (typeof throttledRenderPreview.cancel === "function") {
    throttledRenderPreview.cancel();
  }
  resetResizeStateOnly(); // This now clears activeResizeOperationCache
  document.removeEventListener("mousemove", handleDocumentMouseMove);
  document.removeEventListener("mouseup", handleDocumentMouseUp);
  document.body.style.cursor = "";
}

function addEventResizeListeners() {
  const eventElements = document.querySelectorAll(".event-overlay, .week-event-block, .week-all-day-event-segment");
  eventElements.forEach((overlay) => {
    overlay.removeEventListener("mousedown", handleMouseDownOnOverlay);
    overlay.addEventListener("mousedown", handleMouseDownOnOverlay);
    overlay.removeEventListener("mousemove", handleOverlayMouseMoveForCursor);
    overlay.addEventListener("mousemove", handleOverlayMouseMoveForCursor);
    overlay.removeEventListener("mouseleave", handleOverlayMouseLeaveForCursor);
    overlay.addEventListener("mouseleave", handleOverlayMouseLeaveForCursor);
  });
}
window.addEventResizeListeners = addEventResizeListeners;

function handleOverlayMouseMoveForCursor(event) {
  if (window.calendarInteractionState.isResizing || document.body.classList.contains("is-dragging-active")) return;
  const overlay = event.currentTarget;
  const rect = overlay.getBoundingClientRect();
  const offsetX = event.clientX - rect.left;
  const offsetY = event.clientY - rect.top;
  const overlayWidth = overlay.offsetWidth;
  const overlayHeight = overlay.offsetHeight;
  const currentView = document.getElementById("view-select")?.value || "month";
  let cursor = "move";

  if (currentView === "week" && overlay.classList.contains("week-event-block")) {
    const eventId = overlay.dataset.eventId;
    if (eventId) {
      const eventData = customEvents.find((e) => e.id === eventId);
      if (eventData && eventData.start_utc) {
        if (offsetY < RESIZE_HANDLE_WIDTH_PX) cursor = "ns-resize";
        else if (offsetY > overlayHeight - RESIZE_HANDLE_WIDTH_PX) cursor = "ns-resize";
      }
    }
  } else {
    const isStartSegment = overlay.classList.contains("event-overlay-start") || (currentView === "week" && overlay.classList.contains("week-all-day-event-segment"));
    const isEndSegment = overlay.classList.contains("event-overlay-end") || (currentView === "week" && overlay.classList.contains("week-all-day-event-segment"));
    let handleThreshold = RESIZE_HANDLE_WIDTH_PX;
    const eventId = overlay.dataset.eventId;
    if (eventId) {
      const eventData = customEvents.find((e) => e.id === eventId);
      const isTimedMonthYearEvent = eventData && eventData.start_utc && (currentView === "month" || currentView === "year");
      if (isTimedMonthYearEvent && overlayWidth < RESIZE_HANDLE_WIDTH_PX * 3 && overlayWidth > 0) {
        handleThreshold = Math.max(overlayWidth / 2.5, 5);
      }
    }
    if (isStartSegment && offsetX < handleThreshold) cursor = "ew-resize";
    else if (isEndSegment && offsetX > overlayWidth - handleThreshold) cursor = "ew-resize";
  }
  overlay.style.cursor = cursor;
}

function handleOverlayMouseLeaveForCursor(event) {
  if (!window.calendarInteractionState.isResizing) {
    event.currentTarget.style.cursor = "move";
  }
}
