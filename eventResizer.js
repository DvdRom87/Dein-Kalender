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

let activeResizeOperationCache = {
  currentView: null,
  daysContainer: null,
  allDayColumns: [],
  allDaySlotGeometries: new Map(),
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
const TEMP_IGNORE_POINTER_CLASS = "temp-ignore-pointer";

const previewElementPool = {
  available: [],
  maxElements: 30,
};

function getResizeViewConfig() {
  return {
    viewName: activeResizeOperationCache.currentView,
    overlayHeight: activeResizeOperationCache.currentView === "year" ? 5 : 18,
    verticalSpacing: activeResizeOperationCache.currentView === "year" ? 1 : activeResizeOperationCache.currentView === "month" ? 3 : 2,
    maxPlacementLevels: 3,
    displayZone: resizeCurrentViewAppZone,
    hourHeightPx: HOUR_HEIGHT_IN_WEEK_VIEW,
  };
}

function prepareEventForResize(eventData, viewConfig) {
  const prepared = prepareLuxonDtsForPreview(eventData, viewConfig.displayZone);
  return prepared;
}

function getPreviewElementFromPool() {
  if (previewElementPool.available.length > 0) {
    const el = previewElementPool.available.pop();
    el.style.display = "";
    return el;
  }
  const newEl = document.createElement("div");
  return newEl;
}

function releasePreviewElementToPool(element) {
  if (!element) return;
  element.className = "";
  element.style.cssText = "";
  element.textContent = "";
  element.removeAttribute("data-event-id");
  element.style.display = "none";

  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }

  if (previewElementPool.available.length < previewElementPool.maxElements) {
    previewElementPool.available.push(element);
  } else {
    element.remove();
  }
}

function releaseAllDrawnPreviewsToPool() {
  document.querySelectorAll(`.${PREVIEW_SEGMENT_CLASS}, .${WEEK_RESIZE_PREVIEW_CLASS}`).forEach((el) => {
    releasePreviewElementToPool(el);
  });
}

function cacheSlotGeometries() {
  activeResizeOperationCache.allDaySlotGeometries.clear();
  document.querySelectorAll(".week-all-day-slot[data-date]").forEach((slot) => {
    activeResizeOperationCache.allDaySlotGeometries.set(slot.dataset.date, { width: slot.offsetWidth, left: slot.offsetLeft });
  });
}

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

function getPointerCoordinates(event) {
  return event.touches && event.touches.length > 0 ? event.touches[0] : event;
}

function clearResizePreview() {
  releaseAllDrawnPreviewsToPool();
}

function getVisualEndDate(startDt, endDt, isAllDay) {
  if (isAllDay) return endDt.startOf("day");
  return endDt.hour === 0 && !startDt.hasSame(endDt, "day") ? endDt.minus({ days: 1 }).startOf("day") : endDt.startOf("day");
}

function prepareLuxonDtsForPreview(eventDataForPreview, displayZone) {
  const previewCopy = JSON.parse(JSON.stringify(eventDataForPreview));
  previewCopy._isAllDay = !previewCopy.start_utc;

  try {
    if (previewCopy._isAllDay) {
      previewCopy._startDt = luxon.DateTime.fromISO(previewCopy.start, { zone: displayZone }).startOf("day");
      previewCopy._endDt = luxon.DateTime.fromISO(previewCopy.end, { zone: displayZone }).endOf("day");
    } else {
      if (previewCopy.start_utc && previewCopy.end_utc) {
        previewCopy._startDt = luxon.DateTime.fromISO(previewCopy.start_utc, { zone: "utc" });
        previewCopy._endDt = luxon.DateTime.fromISO(previewCopy.end_utc, { zone: "utc" });
      } else {
        const sTime = previewCopy.time || "00:00";
        const eTime = previewCopy.endTime || sTime;
        const sDate = previewCopy.start;
        const eDate = previewCopy.end || sDate;
        const sZone = previewCopy.startTimezone || displayZone;
        const eZone = previewCopy.endTimezone || displayZone;

        const tempStart = luxon.DateTime.fromISO(`${sDate}T${sTime}`, { zone: sZone });
        previewCopy._startDt = tempStart.isValid ? tempStart.toUTC() : luxon.DateTime.invalid("invalid start parts for preview fallback");

        let tempEnd;
        if (previewCopy.endTime || previewCopy.end) {
          tempEnd = luxon.DateTime.fromISO(`${eDate}T${eTime}`, { zone: eZone });
        } else if (tempStart.isValid) {
          tempEnd = tempStart.plus({ hours: 1 });
        } else {
          tempEnd = luxon.DateTime.invalid("cannot determine end due to invalid start");
        }
        previewCopy._endDt = tempEnd && tempEnd.isValid ? tempEnd.toUTC() : luxon.DateTime.invalid("invalid end parts for preview fallback");
      }
    }
    if (!previewCopy._startDt || !previewCopy._startDt.isValid) {
      previewCopy._startDt = luxon.DateTime.invalid("preview start invalid final check");
    }
    if (!previewCopy._endDt || !previewCopy._endDt.isValid) {
      previewCopy._endDt = luxon.DateTime.invalid("preview end invalid final check");
    }
    if (previewCopy._startDt.isValid && previewCopy._endDt.isValid && previewCopy._endDt < previewCopy._startDt) {
      previewCopy._endDt = previewCopy._startDt.plus({ hours: 1 });
    }
  } catch (e) {
    previewCopy._startDt = luxon.DateTime.invalid("Error in prepareLuxonDtsForPreview");
    previewCopy._endDt = luxon.DateTime.invalid("Error in prepareLuxonDtsForPreview");
  }
  return previewCopy;
}
window.prepareLuxonDtsForPreview = prepareLuxonDtsForPreview;

function _buildRenderedEventLevelsCache(currentView, resizedEventOriginalId, visibleContextElements) {
  const cache = new Map();
  const isResizingThisEventAllDay = originalResizedEvent ? originalResizedEvent._isAllDay : false;

  const eventSelector = (currentView === "week" || currentView === "day") && isResizingThisEventAllDay ? `.week-all-day-event-segment[data-event-id][data-level]` : currentView === "month" || currentView === "year" ? `.event-overlay[data-event-id][data-level]` : null;

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
          if (otherVisualEnd.hour === 0 && otherVisualEnd.minute === 0 && otherVisualEnd.second === 0 && !otherStart.hasSame(otherVisualEnd, "day")) {
            otherVisualEnd = otherVisualEnd.minus({ days: 1 }).startOf("day");
          } else {
            otherVisualEnd = otherVisualEnd.startOf("day");
          }
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
window._findLevelForPreviewSegment = _findLevelForPreviewSegment;

function renderMonthYearResizePreview(previewEventData, viewConfigForPreview) {
  const eventDataWithLuxonDts = prepareLuxonDtsForPreview(previewEventData, viewConfigForPreview.displayZone);
  if (!eventDataWithLuxonDts._startDt.isValid || !eventDataWithLuxonDts._endDt.isValid) return;

  const overallEventVisualStart = eventDataWithLuxonDts._startDt.setZone(viewConfigForPreview.displayZone);
  let overallEventVisualEnd = eventDataWithLuxonDts._endDt.setZone(viewConfigForPreview.displayZone);
  if (eventDataWithLuxonDts._isAllDay) overallEventVisualEnd = overallEventVisualEnd.startOf("day");
  if (overallEventVisualEnd < overallEventVisualStart.startOf("day")) overallEventVisualEnd = overallEventVisualStart.startOf("day");

  const fullOtherEventsCache = originalResizedEvent._otherEventsCache || [];
  const renderedEventLevels = originalResizedEvent._renderedEventLevelsCache || new Map();
  let anySegmentHidden = false;

  document.querySelectorAll(".month-card").forEach((monthCard) => {
    const overlaysFrag = document.createDocumentFragment();
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
        overlaysFrag.appendChild(previewSegmentDiv);
      }
      currentProcessingDay = segmentEndDate.plus({ days: 1 });
    }
    monthCard.appendChild(overlaysFrag);
  });
  if (previewEventData) previewEventData._isOverallCollidingPreview = anySegmentHidden;
}

function renderWeekDayViewResizePreview(previewEventData, viewConfigForPreview) {
  const eventData = prepareLuxonDtsForPreview(previewEventData, viewConfigForPreview.displayZone);
  if (!eventData._startDt.isValid || !eventData._endDt.isValid) return;

  const overallEventVisualStart = eventData._startDt.setZone(viewConfigForPreview.displayZone);
  let overallEventVisualEnd = eventData._endDt.setZone(viewConfigForPreview.displayZone);

  const currentDayColumns = activeResizeOperationCache.allDayColumns;
  if (!currentDayColumns || currentDayColumns.length === 0) return;

  const viewStartDt = luxon.DateTime.fromISO(currentDayColumns[0].element.dataset.date, { zone: viewConfigForPreview.displayZone });
  const numDaysInCurrentView = currentDayColumns.length;

  let isOverallColliding = previewEventData._isOverallCollidingPreview || false;

  if (eventData._isAllDay) {
    const allDayRow = document.querySelector(`.${activeResizeOperationCache.currentView}-view .week-all-day-row`) || document.querySelector(".week-all-day-row");
    if (!allDayRow) return;

    const viewEndDt = viewStartDt.plus({ days: numDaysInCurrentView - 1 });
    const weekSpecificOtherEvents = (originalResizedEvent._otherEventsCache || []).filter((e) => e._isAllDay && e._startDt.isValid && e._endDt.isValid && e.id !== eventData.id && e._startDt.setZone(viewConfigForPreview.displayZone) < viewEndDt.endOf("day") && e._endDt.setZone(viewConfigForPreview.displayZone) >= viewStartDt.startOf("day"));

    const renderedEventLevels = originalResizedEvent._renderedEventLevelsCache || new Map();

    let currentSegmentStartDay = luxon.DateTime.max(overallEventVisualStart.startOf("day"), viewStartDt.startOf("day"));
    const currentSegmentEndDay = luxon.DateTime.min(overallEventVisualEnd.startOf("day"), viewEndDt.startOf("day"));

    if (currentSegmentStartDay.isValid && currentSegmentEndDay.isValid && currentSegmentStartDay <= currentSegmentEndDay) {
      const segmentDataForLevelFinding = {
        segmentStartDt: currentSegmentStartDay,
        segmentEndDt: currentSegmentEndDay,
        _isAllDay: true,
        id: eventData.id,
      };

      const segmentTargetLevel = _findLevelForPreviewSegment(segmentDataForLevelFinding, weekSpecificOtherEvents, renderedEventLevels, viewConfigForPreview);

      if (segmentTargetLevel >= viewConfigForPreview.maxPlacementLevels) isOverallColliding = true;

      let segmentStartDayIndexInView = -1;
      let segmentEndDayIndexInView = -1;

      for (let i = 0; i < numDaysInCurrentView; i++) {
        const dayInGrid = viewStartDt.plus({ days: i }).startOf("day");
        if (dayInGrid.equals(currentSegmentStartDay)) segmentStartDayIndexInView = i;
        if (dayInGrid.equals(currentSegmentEndDay)) {
          segmentEndDayIndexInView = i;
          break;
        }
        if (i === numDaysInCurrentView - 1 && currentSegmentEndDay > dayInGrid) {
          segmentEndDayIndexInView = i;
        }
      }

      if (segmentStartDayIndexInView !== -1 && segmentEndDayIndexInView !== -1 && segmentStartDayIndexInView <= segmentEndDayIndexInView) {
        const firstSlotDateStr = viewStartDt.plus({ days: segmentStartDayIndexInView }).toFormat("yyyy-MM-dd");
        const firstSlotOfDisplaySegment = allDayRow.querySelector(`.week-all-day-slot[data-date="${firstSlotDateStr}"]`);

        if (firstSlotOfDisplaySegment) {
          const previewBlock = getPreviewElementFromPool();
          previewBlock.className = PREVIEW_SEGMENT_CLASS;
          if (isOverallColliding) previewBlock.classList.add(COLLIDING_PREVIEW_CLASS);
          previewBlock.style.backgroundColor = eventData.color ? `${eventData.color}99` : `rgba(59, 130, 246, 0.6)`;
          previewBlock.style.position = "absolute";
          previewBlock.style.top = `${segmentTargetLevel * (viewConfigForPreview.overlayHeight + viewConfigForPreview.verticalSpacing)}px`;
          previewBlock.style.height = `${viewConfigForPreview.overlayHeight}px`;

          let totalWidth = 0;
          let calculatedLeft = firstSlotOfDisplaySegment.offsetLeft;

          if (activeResizeOperationCache.allDaySlotGeometries.size > 0) {
            const firstSlotGeom = activeResizeOperationCache.allDaySlotGeometries.get(firstSlotDateStr);
            if (firstSlotGeom) calculatedLeft = firstSlotGeom.left;
            for (let k = segmentStartDayIndexInView; k <= segmentEndDayIndexInView; k++) {
              const currentSlotDateStr = viewStartDt.plus({ days: k }).toFormat("yyyy-MM-dd");
              const slotGeom = activeResizeOperationCache.allDaySlotGeometries.get(currentSlotDateStr);
              if (slotGeom) totalWidth += slotGeom.width;
              else {
                const slotEl = allDayRow.querySelector(`.week-all-day-slot[data-date="${currentSlotDateStr}"]`);
                if (slotEl) totalWidth += slotEl.offsetWidth;
              }
            }
          } else {
            for (let k = segmentStartDayIndexInView; k <= segmentEndDayIndexInView; k++) {
              const currentSlotDateStr = viewStartDt.plus({ days: k }).toFormat("yyyy-MM-dd");
              const currentSlot = allDayRow.querySelector(`.week-all-day-slot[data-date="${currentSlotDateStr}"]`);
              if (currentSlot) totalWidth += currentSlot.offsetWidth;
            }
          }
          previewBlock.style.left = `${calculatedLeft}px`;

          const segmentIsMultiDayVisual = segmentEndDayIndexInView > segmentStartDayIndexInView;
          const gap = segmentIsMultiDayVisual && numDaysInCurrentView > 1 ? 2 : 0;

          previewBlock.style.width = `${totalWidth > 0 ? totalWidth - gap : 0}px`;
          if (totalWidth <= 0) previewBlock.style.display = "none";

          previewBlock.textContent = eventData.name;
          allDayRow.appendChild(previewBlock);
        }
      }
    }
  } else {
    isOverallColliding = checkCollision(eventData, resizedEventId, activeResizeOperationCache.currentView, viewConfigForPreview.displayZone);
    const timedPreviewFrag = document.createDocumentFragment();
    for (let i = 0; i < numDaysInCurrentView; i++) {
      const currentColumnDay = viewStartDt.plus({ days: i });
      const dayColumnElement = currentDayColumns[i].element;
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
      if (eventEndHourFraction === 0 && endDisp.startOf("day").equals(currentColumnDay) && !startDisp.hasSame(endDisp, "day")) continue;

      if (eventEndHourFraction <= eventStartHourFraction && startDisp.hasSame(endDisp, "day")) {
        if (startDisp.equals(endDisp)) continue;
        eventEndHourFraction = eventStartHourFraction + 15 / 60;
      }

      const top = eventStartHourFraction * HOUR_HEIGHT_IN_WEEK_VIEW;
      let height = (eventEndHourFraction - eventStartHourFraction) * HOUR_HEIGHT_IN_WEEK_VIEW;

      if (height <= 1 && height > 0) height = HOUR_HEIGHT_IN_WEEK_VIEW / 4;
      if (height <= 0) continue;

      const previewBlock = getPreviewElementFromPool();
      previewBlock.className = WEEK_RESIZE_PREVIEW_CLASS;
      if (isOverallColliding) previewBlock.classList.add(COLLIDING_PREVIEW_CLASS);
      previewBlock.style.backgroundColor = eventData.color ? `${eventData.color}99` : `rgba(59, 130, 246, 0.6)`;
      previewBlock.style.top = `${top}px`;
      previewBlock.style.height = `${height}px`;
      previewBlock.style.left = `0%`;
      previewBlock.style.width = `calc(100% - 4px)`;
      previewBlock.style.marginLeft = `2px`;
      if (currentColumnDay.hasSame(startDisp, "day")) previewBlock.textContent = `${eventData.name}`;

      dayColumnElement.appendChild(previewBlock);
    }
  }
  if (previewEventData) previewEventData._isOverallCollidingPreview = isOverallColliding;
}

function renderResizePreview(previewEventData) {
  clearResizePreview();
  const viewConfig = getResizeViewConfig();
  const preparedEvent = prepareEventForResize(previewEventData, viewConfig);

  if (viewConfig.viewName === "month" || viewConfig.viewName === "year") {
    renderMonthYearResizePreview(preparedEvent, viewConfig);
  } else if (viewConfig.viewName === "week" || viewConfig.viewName === "day") {
    renderWeekDayViewResizePreview(preparedEvent, viewConfig);
  }
}

function calculateResizedEventProperties(originalEvent, newTargetInfo, resizeMode, currentView, appZone) {
  const updatedEvent = { ...originalEvent };
  const isOriginalAllDay = typeof originalEvent._isAllDay === "boolean" ? originalEvent._isAllDay : !originalEvent.start_utc;
  const originalStartTimezone = originalEvent.startTimezone || appZone;
  const originalEndTimezone = originalEvent.endTimezone || appZone;

  if ((currentView === "week" || currentView === "day") && !isOriginalAllDay && (resizeMode === "top" || resizeMode === "bottom")) {
    const targetDateStr = newTargetInfo.dateString;
    let targetHour = newTargetInfo.hour;

    const originalStartUtcDt = originalEvent._startDt && originalEvent._startDt.isValid ? originalEvent._startDt : luxon.DateTime.fromISO(originalEvent.start_utc, { zone: "utc" });
    const originalEndUtcDt = originalEvent._endDt && originalEvent._endDt.isValid ? originalEvent._endDt : luxon.DateTime.fromISO(originalEvent.end_utc, { zone: "utc" });

    if (!originalStartUtcDt.isValid || !originalEndUtcDt.isValid) {
      return updatedEvent;
    }

    const minDuration = luxon.Duration.fromObject({ hours: 1 });
    let newStartLocal, newEndLocal;

    if (resizeMode === "top") {
      newStartLocal = luxon.DateTime.fromISO(targetDateStr, { zone: originalStartTimezone }).set({ hour: targetHour, minute: 0, second: 0, millisecond: 0 });
      newEndLocal = originalEndUtcDt.setZone(originalEndTimezone);

      if (newStartLocal.plus(minDuration) > newEndLocal) {
        newEndLocal = newStartLocal.plus(minDuration);
      }
    } else {
      newEndLocal = luxon.DateTime.fromISO(targetDateStr, { zone: originalEndTimezone }).set({ hour: targetHour + 1, minute: 0, second: 0, millisecond: 0 });
      newStartLocal = originalStartUtcDt.setZone(originalStartTimezone);

      if (newEndLocal.minus(minDuration) < newStartLocal) {
        newStartLocal = newEndLocal.minus(minDuration);
      }
    }

    if (newStartLocal.isValid && newEndLocal.isValid && newStartLocal.toUTC() >= newEndLocal.toUTC()) {
      if (resizeMode === "top") {
        newEndLocal = newStartLocal.plus(minDuration.isValid ? minDuration : { minutes: 15 });
      } else {
        newStartLocal = newEndLocal.minus(minDuration.isValid ? minDuration : { minutes: 15 });
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
    const newDateCellString = newTargetInfo.dateString;
    const newTargetDayOnlyDt = luxon.DateTime.fromISO(newDateCellString, { zone: appZone }).startOf("day");

    if (isOriginalAllDay) {
      let currentStartDt = luxon.DateTime.fromISO(originalEvent.start, { zone: appZone }).startOf("day");
      let currentEndDt = luxon.DateTime.fromISO(originalEvent.end, { zone: appZone }).startOf("day");
      if (resizeMode === "start") {
        currentStartDt = newTargetDayOnlyDt;
        if (currentStartDt.isValid && currentEndDt.isValid && currentStartDt > currentEndDt) currentEndDt = currentStartDt;
      } else {
        currentEndDt = newTargetDayOnlyDt;
        if (currentStartDt.isValid && currentEndDt.isValid && currentEndDt < currentStartDt) currentStartDt = currentEndDt;
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
      const origStartStr = originalEvent.time || "00:00";
      const origEndStr = originalEvent.endTime || "00:00";
      let finalEffectiveStartDate = luxon.DateTime.fromISO(originalEvent.start, { zone: appZone }).startOf("day");
      let finalEffectiveEndDate = luxon.DateTime.fromISO(originalEvent.end, { zone: appZone }).startOf("day");

      if (resizeMode === "start") {
        finalEffectiveStartDate = newTargetDayOnlyDt;
        if (finalEffectiveStartDate.isValid && finalEffectiveEndDate.isValid && finalEffectiveStartDate > finalEffectiveEndDate) {
          finalEffectiveEndDate = finalEffectiveStartDate;
        }
      } else {
        finalEffectiveEndDate = newTargetDayOnlyDt;
        if (finalEffectiveStartDate.isValid && finalEffectiveEndDate.isValid && finalEffectiveEndDate < finalEffectiveStartDate) {
          finalEffectiveStartDate = finalEffectiveEndDate;
        }
      }

      const [sH, sM] = origStartStr.split(":").map(Number);
      const [eH, eM] = origEndStr.split(":").map(Number);
      let finalNewStartLocal = finalEffectiveStartDate.setZone(originalEvent.startTimezone || appZone).set({ hour: sH, minute: sM });
      let finalNewEndLocal = finalEffectiveEndDate.setZone(originalEvent.endTimezone || appZone).set({ hour: eH, minute: eM });

      if (finalNewStartLocal.isValid && finalNewEndLocal.isValid && finalNewStartLocal.toUTC() >= finalNewEndLocal.toUTC()) {
        finalNewEndLocal = finalNewStartLocal.setZone(originalEvent.endTimezone || appZone).plus({ hours: 1 });
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

function isTimedEvent(view, eventData) {
  if (!eventData) return false;
  if (view === "week" || view === "day") {
    return eventData._isAllDay === false;
  }
  return !!eventData.start_utc;
}

function getDayInterval(eventData, dayString, zone) {
  if (!eventData || !eventData._startDt || !eventData._startDt.isValid || !eventData._endDt || !eventData._endDt.isValid) {
    return luxon.Interval.invalid("Invalid event data for interval");
  }

  const dayStart = luxon.DateTime.fromISO(dayString, { zone }).startOf("day");
  const dayEnd = luxon.DateTime.fromISO(dayString, { zone }).endOf("day");

  const eventStartInZone = eventData._startDt.setZone(zone);
  const eventEndInZone = eventData._endDt.setZone(zone);

  if (!eventStartInZone.isValid || !eventEndInZone.isValid) {
    return luxon.Interval.invalid("Event dates invalid in target zone");
  }

  const intervalStart = luxon.DateTime.max(eventStartInZone, dayStart);
  const intervalEnd = luxon.DateTime.min(eventEndInZone, dayEnd);

  if (intervalStart >= intervalEnd) {
    return luxon.Interval.invalid("No overlap with the specified day");
  }

  return luxon.Interval.fromDateTimes(intervalStart, intervalEnd);
}

function checkCollision(previewEvent, originalId, view, zone) {
  if (!isTimedEvent(view, previewEvent)) {
    return false;
  }

  if (!activeResizeOperationCache || !activeResizeOperationCache.allDayColumns || activeResizeOperationCache.allDayColumns.length === 0) {
    return false;
  }
  if (!originalResizedEvent || !originalResizedEvent._otherEventsCache) {
    return false;
  }

  return activeResizeOperationCache.allDayColumns.some((column) => {
    const day = column.element.dataset.date;
    const previewInterval = getDayInterval(previewEvent, day, zone);
    if (!previewInterval || !previewInterval.isValid) return false;

    return originalResizedEvent._otherEventsCache.some((other) => {
      if (other._isAllDay || other.id === originalId) return false;

      const otherInterval = getDayInterval(other, day, zone);
      if (!otherInterval || !otherInterval.isValid) return false;

      return otherInterval.overlaps(previewInterval);
    });
  });
}
window.checkCollision = checkCollision;

function getElementUnderCursorIgnoringPreviews(clientX, clientY) {
  const previewSelectors = [`.${PREVIEW_SEGMENT_CLASS}`, `.${WEEK_RESIZE_PREVIEW_CLASS}`];
  const temporarilyIgnoredElements = [];

  document.querySelectorAll(previewSelectors.join(",")).forEach((el) => {
    if (el.style.display !== "none") {
      temporarilyIgnoredElements.push(el);
      el.classList.add(TEMP_IGNORE_POINTER_CLASS);
    }
  });

  let element = document.elementFromPoint(clientX, clientY);

  temporarilyIgnoredElements.forEach((el) => {
    el.classList.remove(TEMP_IGNORE_POINTER_CLASS);
  });

  return element;
}

function _initiateResize(pointerEvent, isTouch = false) {
  if (!isTouch && pointerEvent.button !== 0) return;
  if (document.body.classList.contains("is-dragging-active") && !window.calendarInteractionState.isResizing) return;
  if (window.calendarInteractionState.isResizing && resizedEventId) return;

  const overlay = pointerEvent.target.closest(".event-overlay, .week-event-block, .week-all-day-event-segment");
  if (!overlay) return;
  const eventId = overlay.dataset.eventId;
  const currentEventData = customEvents.find((e) => e.id === eventId);
  if (!currentEventData) return;

  const eventDataForResizeInit = currentEventData._startDt && currentEventData._endDt && currentEventData._startDt.isValid && currentEventData._endDt.isValid ? { ...currentEventData } : prepareLuxonDtsForPreview({ ...currentEventData }, luxon.DateTime.local().zoneName);

  if (!eventDataForResizeInit._startDt || !eventDataForResizeInit._startDt.isValid || !eventDataForResizeInit._endDt || !eventDataForResizeInit._endDt.isValid) {
    return;
  }

  const rect = overlay.getBoundingClientRect();
  const coords = getPointerCoordinates(pointerEvent);
  const offsetX = coords.clientX - rect.left;
  const offsetY = coords.clientY - rect.top;
  const overlayWidth = overlay.offsetWidth;
  const overlayHeight = overlay.offsetHeight;
  let localResizeMode = null;
  const currentViewValue = viewSelect.value;
  const isEventBeingResizedAllDay = eventDataForResizeInit._isAllDay;

  originalResizedEvent = JSON.parse(JSON.stringify(eventDataForResizeInit));
  originalResizedEvent._startDt = eventDataForResizeInit._startDt;
  originalResizedEvent._endDt = eventDataForResizeInit._endDt;
  originalResizedEvent._isAllDay = isEventBeingResizedAllDay;

  if ((currentViewValue === "week" || currentViewValue === "day") && overlay.classList.contains("week-event-block") && !isEventBeingResizedAllDay) {
    if (offsetY < RESIZE_HANDLE_WIDTH_PX) localResizeMode = "top";
    else if (offsetY > overlayHeight - RESIZE_HANDLE_WIDTH_PX) localResizeMode = "bottom";
  } else if (overlay.classList.contains("event-overlay") || overlay.classList.contains("week-all-day-event-segment")) {
    const canResizeStart = overlay.classList.contains("event-overlay-start") || overlay.classList.contains("week-all-day-event-segment");
    const canResizeEnd = overlay.classList.contains("event-overlay-end") || overlay.classList.contains("week-all-day-event-segment");
    const clickOnStartArea = offsetX >= 0 && offsetX < RESIZE_HANDLE_WIDTH_PX;
    const clickOnEndArea = offsetX >= overlayWidth - RESIZE_HANDLE_WIDTH_PX && offsetX <= overlayWidth;

    if (canResizeStart && clickOnStartArea) {
      if (canResizeEnd && clickOnEndArea) {
        if (overlayWidth < RESIZE_HANDLE_WIDTH_PX * 1.5) localResizeMode = null;
        else if (offsetX < overlayWidth / 2) localResizeMode = "start";
        else localResizeMode = "end";
      } else {
        localResizeMode = "start";
      }
    } else if (canResizeEnd && clickOnEndArea) {
      localResizeMode = "end";
    } else {
      localResizeMode = null;
    }
  }

  if (localResizeMode) {
    pointerEvent.preventDefault();
    if (isTouch) pointerEvent.stopPropagation();

    window.calendarInteractionState.isResizing = true;
    resizeMode = localResizeMode;
    resizedEventId = eventId;

    resizeCurrentViewAppZone = luxon.DateTime.local().zoneName;
    lastValidResizeTargetInfo = null;
    currentHoverTargetElement = null;
    lastPreviewRecalculationTargetKey = null;

    activeResizeOperationCache.currentView = currentViewValue;
    if (currentViewValue === "week" || currentViewValue === "day") {
      activeResizeOperationCache.daysContainer = document.querySelector(`.${currentViewValue}-view .week-days-container`) || document.querySelector(".week-days-container");
      if (activeResizeOperationCache.daysContainer) {
        activeResizeOperationCache.allDayColumns = Array.from(activeResizeOperationCache.daysContainer.querySelectorAll(".week-day-column[data-date]")).map((col) => ({ element: col, rect: col.getBoundingClientRect() }));
      } else {
        activeResizeOperationCache.allDayColumns = Array.from(document.querySelectorAll(`.calendar-container.${currentViewValue}-view .week-day-column[data-date]`)).map((col) => ({ element: col, rect: col.getBoundingClientRect() }));
      }

      const allDayRowForCache = document.querySelector(`.${currentViewValue}-view .week-all-day-row`) || document.querySelector(".week-all-day-row");
      cacheSlotGeometries();
      if (allDayRowForCache) {
        allDayRowForCache.querySelectorAll(".week-all-day-slot[data-date]").forEach((slot) => {
          activeResizeOperationCache.allDaySlotGeometries.set(slot.dataset.date, {
            width: slot.offsetWidth,
            left: slot.offsetLeft,
          });
        });
      }
    } else {
      activeResizeOperationCache.daysContainer = null;
      activeResizeOperationCache.allDayColumns = [];
      cacheSlotGeometries();
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

    let visibleContextsForLevelCache = [];
    if (activeResizeOperationCache.currentView === "month" || activeResizeOperationCache.currentView === "year" || ((activeResizeOperationCache.currentView === "week" || activeResizeOperationCache.currentView === "day") && originalResizedEvent._isAllDay)) {
      if (activeResizeOperationCache.currentView === "month" || activeResizeOperationCache.currentView === "year") {
        visibleContextsForLevelCache = Array.from(document.querySelectorAll(".month-card"));
      } else {
        const allDayRow = document.querySelector(`.${activeResizeOperationCache.currentView}-view .week-all-day-row`) || document.querySelector(".week-all-day-row");
        if (allDayRow) visibleContextsForLevelCache = [allDayRow];
      }
      originalResizedEvent._renderedEventLevelsCache = _buildRenderedEventLevelsCache(activeResizeOperationCache.currentView, resizedEventId, visibleContextsForLevelCache);
    } else {
      originalResizedEvent._renderedEventLevelsCache = new Map();
    }

    document.querySelectorAll(".event-overlay, .week-event-block, .week-all-day-event-segment").forEach((o) => {
      if (o.dataset.eventId !== resizedEventId) o.classList.add(RESIZE_OBSTRUCTING_IGNORE_CLASS);
    });
    document.querySelectorAll(`.${EVENT_OVERLAY_CLASS}[data-event-id="${resizedEventId}"], .${WEEK_EVENT_BLOCK_CLASS}[data-event-id="${resizedEventId}"], .${WEEK_ALL_DAY_EVENT_SEGMENT_CLASS}[data-event-id="${resizedEventId}"]`).forEach((seg) => seg.classList.add(RESIZING_ORIGINAL_HIDDEN_CLASS));

    const initialPreviewData = { ...originalResizedEvent, _isOverallCollidingPreview: false };
    throttledRenderPreview(initialPreviewData);

    if (isTouch) {
      document.addEventListener("touchmove", handlePointerMove, { passive: false });
      document.addEventListener("touchend", _handleDocumentTouchEnd, { once: true });
      document.addEventListener("touchcancel", _handleDocumentTouchEnd, { once: true });
    } else {
      document.addEventListener("mousemove", handlePointerMove);
      document.addEventListener("mouseup", _handleDocumentMouseUp, { once: true });
    }

    document.body.classList.add("is-resizing-active");
    document.body.style.cursor = resizeMode === "top" || resizeMode === "bottom" ? "ns-resize" : "ew-resize";
  }
}

function handleMouseDownOnOverlay(event) {
  _initiateResize(event, false);
}

function _handleTouchStartOnOverlay(event) {
  _initiateResize(event, true);
}

function isTouchEvent(event) {
  return event.touches && event.touches.length > 0;
}

function _performResizeUpdate(pointerEvent) {
  if (!window.calendarInteractionState.isResizing || !originalResizedEvent) return;
  let potentialTargetInfo = null;
  let newHoverElement = null;
  let currentTargetKey = null;

  const isOriginalTimed = originalResizedEvent && !originalResizedEvent._isAllDay;
  const hasValidOriginalDates = originalResizedEvent && originalResizedEvent._startDt && originalResizedEvent._startDt.isValid;
  const coords = getPointerCoordinates(pointerEvent);

  if ((activeResizeOperationCache.currentView === "week" || activeResizeOperationCache.currentView === "day") && isOriginalTimed && hasValidOriginalDates && (resizeMode === "top" || resizeMode === "bottom")) {
    if (activeResizeOperationCache.allDayColumns.length > 0) {
      let targetDayColumnData = null;
      for (const colData of activeResizeOperationCache.allDayColumns) {
        if (coords.clientX >= colData.rect.left && coords.clientX <= colData.rect.right) {
          targetDayColumnData = colData;
          break;
        }
      }
      if (targetDayColumnData && targetDayColumnData.element.dataset.date) {
        const relativeYInColumn = coords.clientY - targetDayColumnData.rect.top;
        let hourIndex = Math.floor(relativeYInColumn / HOUR_HEIGHT_IN_WEEK_VIEW);
        hourIndex = Math.max(0, Math.min(23, hourIndex));
        potentialTargetInfo = { dateString: targetDayColumnData.element.dataset.date, hour: hourIndex };
        currentTargetKey = `${potentialTargetInfo.dateString}-${potentialTargetInfo.hour}`;
        const targetTimeStr = `${String(hourIndex).padStart(2, "0")}:00`;
        newHoverElement = targetDayColumnData.element.querySelector(`.hour-slot[data-time="${targetTimeStr}"][data-date="${targetDayColumnData.element.dataset.date}"]`) || targetDayColumnData.element;
      }
    }
  } else {
    const tempElement = getElementUnderCursorIgnoringPreviews(coords.clientX, coords.clientY);
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
      if (activeResizeOperationCache.currentView === "month" || activeResizeOperationCache.currentView === "year" || ((activeResizeOperationCache.currentView === "week" || activeResizeOperationCache.currentView === "day") && preparedPreviewData._isAllDay)) {
        let visibleContexts = [];
        if (activeResizeOperationCache.currentView === "month" || activeResizeOperationCache.currentView === "year") {
          visibleContexts = Array.from(document.querySelectorAll(".month-card"));
        } else {
          const allDayRowContainer = document.querySelector(`.${activeResizeOperationCache.currentView}-view .week-all-day-row`) || document.querySelector(".week-all-day-row");
          if (allDayRowContainer) visibleContexts = [allDayRowContainer];
        }
        if (originalResizedEvent && visibleContexts.length > 0) {
          originalResizedEvent._renderedEventLevelsCache = _buildRenderedEventLevelsCache(activeResizeOperationCache.currentView, resizedEventId, visibleContexts);
        }
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

function handlePointerMove(event) {
  if (isTouchEvent(event)) event.preventDefault();
  _performResizeUpdate(event);
}

function _finalizeResize(pointerEvent) {
  document.body.classList.remove("is-resizing-active");
  document.body.style.cursor = "";

  if (!window.calendarInteractionState.isResizing || !resizedEventId || !originalResizedEvent) {
    resetResizeState();
    return;
  }
  pointerEvent.preventDefault();
  resetPointerEventsAndPreview();
  document.querySelectorAll(`.${RESIZING_ORIGINAL_HIDDEN_CLASS}[data-event-id="${resizedEventId}"]`).forEach((seg) => seg.classList.remove(RESIZING_ORIGINAL_HIDDEN_CLASS));

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
  resetResizeState();
  if (typeof window.renderEventVisuals === "function") requestAnimationFrame(window.renderEventVisuals);
}

function _handleDocumentMouseUp(event) {
  document.removeEventListener("mousemove", handlePointerMove);
  _finalizeResize(event);
}

function _handleDocumentTouchEnd(event) {
  document.removeEventListener("touchmove", handlePointerMove);
  _finalizeResize(event);
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
  activeResizeOperationCache.currentView = null;
  activeResizeOperationCache.daysContainer = null;
  activeResizeOperationCache.allDayColumns = [];
  activeResizeOperationCache.allDaySlotGeometries.clear();
}

function resetResizeState() {
  resetPointerEventsAndPreview();
  if (window.calendarInteractionState) window.calendarInteractionState.isResizing = false;
  document.querySelectorAll(`.${RESIZING_ORIGINAL_HIDDEN_CLASS}`).forEach((seg) => seg.classList.remove(RESIZING_ORIGINAL_HIDDEN_CLASS));
  if (currentHoverTargetElement) currentHoverTargetElement.classList.remove(RESIZE_TARGET_HOVER_CLASS);

  if (typeof throttledRenderPreview.cancel === "function") {
    throttledRenderPreview.cancel();
  }
  resetResizeStateOnly();
  document.removeEventListener("mousemove", handlePointerMove);
  document.removeEventListener("mouseup", _handleDocumentMouseUp);
  document.removeEventListener("touchmove", handlePointerMove);
  document.removeEventListener("touchend", _handleDocumentTouchEnd);
  document.body.style.cursor = "";
}

function addEventResizeListeners() {
  const eventElements = document.querySelectorAll(".event-overlay, .week-event-block, .week-all-day-event-segment");
  eventElements.forEach((overlay) => {
    overlay.removeEventListener("mousedown", handleMouseDownOnOverlay);
    overlay.addEventListener("mousedown", handleMouseDownOnOverlay);
    overlay.removeEventListener("touchstart", _handleTouchStartOnOverlay);
    overlay.addEventListener("touchstart", _handleTouchStartOnOverlay, { passive: false });
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
  const coords = getPointerCoordinates(event);
  const rect = overlay.getBoundingClientRect();
  const offsetX = coords.clientX - rect.left;
  const offsetY = coords.clientY - rect.top;
  const overlayWidth = overlay.offsetWidth;
  const overlayHeight = overlay.offsetHeight;
  const currentView = document.getElementById("view-select")?.value || "month";
  let cursor = "move";

  if ((currentView === "week" || currentView === "day") && overlay.classList.contains("week-event-block")) {
    const eventId = overlay.dataset.eventId;
    if (eventId) {
      const eventData = customEvents.find((e) => e.id === eventId);
      if (eventData && eventData.start_utc) {
        if (offsetY < RESIZE_HANDLE_WIDTH_PX) cursor = "ns-resize";
        else if (offsetY > overlayHeight - RESIZE_HANDLE_WIDTH_PX) cursor = "ns-resize";
      }
    }
  } else {
    const isPotentiallyResizableHorizontally = overlay.classList.contains(EVENT_OVERLAY_CLASS) || overlay.classList.contains(WEEK_ALL_DAY_EVENT_SEGMENT_CLASS);

    if (isPotentiallyResizableHorizontally) {
      let handleThreshold = RESIZE_HANDLE_WIDTH_PX;
      const eventId = overlay.dataset.eventId;
      if (eventId) {
        const eventData = customEvents.find((e) => e.id === eventId);
        const isTimedMonthYearEvent = eventData && eventData.start_utc && (currentView === "month" || currentView === "year");
        if (isTimedMonthYearEvent && overlayWidth < RESIZE_HANDLE_WIDTH_PX * 3 && overlayWidth > 0) {
          handleThreshold = Math.max(overlayWidth / 3, 5);
        }
      }

      const canResizeStart = overlay.classList.contains("event-overlay-start") || overlay.classList.contains("week-all-day-event-segment");
      const canResizeEnd = overlay.classList.contains("event-overlay-end") || overlay.classList.contains("week-all-day-event-segment");

      if (canResizeStart && offsetX < handleThreshold) cursor = "ew-resize";
      else if (canResizeEnd && offsetX > overlayWidth - handleThreshold) cursor = "ew-resize";
    }
  }
  overlay.style.cursor = cursor;
}

function handleOverlayMouseLeaveForCursor(event) {
  if (!window.calendarInteractionState.isResizing) {
    event.currentTarget.style.cursor = "move";
  }
}
