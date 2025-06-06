if (typeof window.calendarInteractionState === "undefined") {
  window.calendarInteractionState = { isResizing: false };
}

let draggedEventElement = null;
let draggedEventData = null;
let currentDroppableTarget = null;
let lastValidDropTargetInfo = null;

const { DateTime, Duration, Interval } = luxon;

const IGNORE_POINTER_CLASS = "ignore-pointer-during-drag";
const DRAG_OVER_CLASS = "drag-over";
const IS_DRAGGING_CLASS = "is-dragging-active";
const EVENT_OVERLAY_CLASS = "event-overlay";
const WEEK_EVENT_BLOCK_CLASS = "week-event-block";
const WEEK_ALL_DAY_EVENT_SEGMENT_CLASS = "week-all-day-event-segment";
const DRAGGING_ORIGINAL_HIDDEN_CLASS = "dragging-original-hidden";
const DRAG_PREVIEW_SEGMENT_CLASS = "drag-preview-segment";
const WEEK_DRAG_PREVIEW_BLOCK_CLASS = "week-drag-preview-block";
const DRAG_PREVIEW_COLLIDING_CLASS = "colliding";
const DRAG_GHOST_CLASS = "drag-ghost";

const activeDragOperationCache = {
  view: null,
  displayZone: null,
  hourHeightPx: 40,
  overlayHeight: 18,
  verticalSpacing: 2,
  maxPlacementLevels: 3,
  isAllDayDrag: false,
};

const throttledRenderDragPreview = (() => {
  let timeout;
  return (data) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => renderDragPreview(data), 50);
  };
})();

function prepareEventForPreview(eventData, displayZone) {
  const previewCopy = JSON.parse(JSON.stringify(eventData));
  previewCopy._isAllDay = !previewCopy.start_utc;

  try {
    if (previewCopy._isAllDay) {
      previewCopy._startDt = DateTime.fromISO(previewCopy.start, { zone: displayZone }).startOf("day");
      previewCopy._endDt = DateTime.fromISO(previewCopy.end, { zone: displayZone }).endOf("day");
    } else {
      previewCopy._startDt = DateTime.fromISO(previewCopy.start_utc, { zone: "utc" });
      previewCopy._endDt = DateTime.fromISO(previewCopy.end_utc, { zone: "utc" });
    }
    if (!previewCopy._startDt.isValid || !previewCopy._endDt.isValid) throw new Error("Invalid dates");
    if (previewCopy._endDt < previewCopy._startDt) previewCopy._endDt = previewCopy._startDt;
  } catch (e) {
    previewCopy._startDt = DateTime.invalid("preview prep error");
    previewCopy._endDt = DateTime.invalid("preview prep error");
  }
  return previewCopy;
}

function clearDragPreview() {
  document.querySelectorAll(`.${DRAG_PREVIEW_SEGMENT_CLASS}, .${WEEK_DRAG_PREVIEW_BLOCK_CLASS}`).forEach((el) => el.remove());
}

function handleDragStart(event) {
  if (window.calendarInteractionState.isResizing) {
    event.preventDefault();
    return;
  }
  const targetEventElement = event.target.closest(`.${EVENT_OVERLAY_CLASS}, .${WEEK_EVENT_BLOCK_CLASS}, .${WEEK_ALL_DAY_EVENT_SEGMENT_CLASS}`);
  if (!targetEventElement) return;

  draggedEventElement = targetEventElement;
  const eventId = draggedEventElement.dataset.eventId;
  if (!eventId) return;

  const sourceEvent = customEvents.find((e) => e.id === eventId);
  if (!sourceEvent) {
    event.preventDefault();
    cleanupDragState();
    return;
  }

  activeDragOperationCache.view = document.getElementById("view-select")?.value || "month";
  activeDragOperationCache.displayZone = DateTime.local().zoneName;
  activeDragOperationCache.isAllDayDrag = !sourceEvent.start_utc;

  const preparedSource = prepareEventForPreview(sourceEvent, activeDragOperationCache.displayZone);
  draggedEventData = {
    eventId,
    originalEventProperties: preparedSource,
    originalDuration: null,
    otherEventsCache: [],
    renderedEventLevelsCache: new Map(),
  };

  if (!draggedEventData.originalEventProperties._isAllDay && preparedSource._startDt.isValid && preparedSource._endDt.isValid) {
    draggedEventData.originalDuration = preparedSource._endDt.diff(preparedSource._startDt);
  }

  try {
    event.dataTransfer.setData("text/plain", eventId);
    event.dataTransfer.effectAllowed = "move";
  } catch (e) {
    try {
      event.dataTransfer.setData("text", eventId);
      event.dataTransfer.effectAllowed = "move";
    } catch (e2) {
      event.preventDefault();
      cleanupDragState();
      return;
    }
  }

  document.querySelectorAll(`.${EVENT_OVERLAY_CLASS}, .${WEEK_EVENT_BLOCK_CLASS}, .${WEEK_ALL_DAY_EVENT_SEGMENT_CLASS}`).forEach((el) => {
    if (el.dataset.eventId !== eventId) el.classList.add(IGNORE_POINTER_CLASS);
  });
  document.body.classList.add(IS_DRAGGING_CLASS);

  const ghostSucceeded = createAndSetDragImageForMouse(event);
  if (ghostSucceeded) {
    requestAnimationFrame(() => {
      document.querySelectorAll(`[data-event-id="${eventId}"].${EVENT_OVERLAY_CLASS}, [data-event-id="${eventId}"].${WEEK_EVENT_BLOCK_CLASS}, [data-event-id="${eventId}"].${WEEK_ALL_DAY_EVENT_SEGMENT_CLASS}`).forEach((segment) => segment.classList.add(DRAGGING_ORIGINAL_HIDDEN_CLASS));
    });
  }
}

function createAndSetDragImageForMouse(event) {
  if (!draggedEventElement) return false;
  const ghost = draggedEventElement.cloneNode(true);
  ghost.style.opacity = "";
  ghost.style.visibility = "visible";
  ghost.style.display = "";
  ghost.style.pointerEvents = "none";
  ghost.classList.remove(DRAGGING_ORIGINAL_HIDDEN_CLASS, IGNORE_POINTER_CLASS);
  ghost.classList.add(DRAG_GHOST_CLASS);

  Object.assign(ghost.style, {
    position: "absolute",
    top: "-9999px",
    left: "-9999px",
    zIndex: "99999",
    width: `${draggedEventElement.offsetWidth}px`,
    height: `${draggedEventElement.offsetHeight}px`,
  });
  document.body.appendChild(ghost);
  try {
    const rect = draggedEventElement.getBoundingClientRect();
    event.dataTransfer.setDragImage(ghost, event.clientX - rect.left, event.clientY - rect.top);
    return true;
  } catch (e) {
    ghost.remove();
    return false;
  }
}

function handleDayDragEnter(event) {
  if (!draggedEventData) return;
  const targetElement = event.currentTarget;
  if (!targetElement.matches(".day:not(.empty-day)[data-date], .week-all-day-slot[data-date], .hour-slot[data-date][data-time]")) return;
  if (currentDroppableTarget && currentDroppableTarget !== targetElement) currentDroppableTarget.classList.remove(DRAG_OVER_CLASS);
  targetElement.classList.add(DRAG_OVER_CLASS);
  currentDroppableTarget = targetElement;
  lastValidDropTargetInfo = getTargetInfoFromElement(targetElement);
}

function handleDayDragOver(event) {
  event.preventDefault();
  const targetElement = event.currentTarget;
  if (!targetElement.matches(".day:not(.empty-day)[data-date], .week-all-day-slot[data-date], .hour-slot[data-date][data-time]")) {
    event.dataTransfer.dropEffect = "none";
    return;
  }
  event.dataTransfer.dropEffect = draggedEventData ? "move" : "none";
  lastValidDropTargetInfo = getTargetInfoFromElement(targetElement);
}

function handleDayDragLeave(event) {
  const targetElement = event.currentTarget;
  if (!targetElement.matches(".day:not(.empty-day)[data-date], .week-all-day-slot[data-date], .hour-slot[data-date][data-time]")) return;
  if (!targetElement.contains(event.relatedTarget) && currentDroppableTarget === targetElement) {
    targetElement.classList.remove(DRAG_OVER_CLASS);
    currentDroppableTarget = null;
  }
}

function handleDayDrop(event) {
  event.preventDefault();
  const dropTarget = event.currentTarget;
  dropTarget.classList.remove(DRAG_OVER_CLASS);
  if (!draggedEventData || !draggedEventData.eventId) {
    cleanupDragState();
    return;
  }

  const finalDropTargetInfo = getTargetInfoFromElement(dropTarget) || lastValidDropTargetInfo;
  if (!finalDropTargetInfo) {
    cleanupDragState();
    return;
  }

  const eventToMove = customEvents.find((e) => e.id === draggedEventData.eventId);
  if (eventToMove && finalDropTargetInfo.dateString) {
    const isDroppedOnHourSlot = dropTarget.classList.contains("hour-slot");
    const isDroppedOnWeekAllDaySlot = dropTarget.classList.contains("week-all-day-slot");

    let dropIntentIsAllDay = draggedEventData.originalEventProperties._isAllDay;
    if (isDroppedOnHourSlot) dropIntentIsAllDay = false;
    else if (isDroppedOnWeekAllDaySlot) dropIntentIsAllDay = true;

    updateEventDates(eventToMove, finalDropTargetInfo.dateString, finalDropTargetInfo.time, dropIntentIsAllDay, draggedEventData.originalDuration);
    if (typeof saveEvents === "function") saveEvents();
    if (typeof window.updateCalendar === "function") window.updateCalendar();
  }
  cleanupDragState();
}

function handleDragEnd(event) {
  cleanupDragState();
}

function handleTouchStart(event) {
  if (window.calendarInteractionState.isResizing) return;

  const targetEventElement = event.target.closest(`.${EVENT_OVERLAY_CLASS}, .${WEEK_EVENT_BLOCK_CLASS}, .${WEEK_ALL_DAY_EVENT_SEGMENT_CLASS}`);
  if (!targetEventElement) return;

  const rect = targetEventElement.getBoundingClientRect();
  const touch = event.touches[0];
  const offsetX = touch.clientX - rect.left;
  const offsetY = touch.clientY - rect.top;
  const currentView = document.getElementById("view-select")?.value || "month";
  let isResizeGesture = false;

  if ((currentView === "week" || currentView === "day") && targetEventElement.classList.contains(WEEK_EVENT_BLOCK_CLASS)) {
    const eventData = customEvents.find((e) => e.id === targetEventElement.dataset.eventId);
    if (eventData && eventData.start_utc) {
      if (offsetY < 10 || offsetY > targetEventElement.offsetHeight - 10) isResizeGesture = true;
    }
  } else if (targetEventElement.classList.contains(EVENT_OVERLAY_CLASS) || targetEventElement.classList.contains(WEEK_ALL_DAY_EVENT_SEGMENT_CLASS)) {
    if (offsetX < 10 || offsetX > targetEventElement.offsetWidth - 10) isResizeGesture = true;
  }

  if (isResizeGesture) return;

  event.preventDefault();

  draggedEventElement = targetEventElement;
  const eventId = draggedEventElement.dataset.eventId;
  if (!eventId) return;

  const sourceEvent = customEvents.find((e) => e.id === eventId);
  if (!sourceEvent) {
    cleanupDragState();
    return;
  }

  activeDragOperationCache.view = currentView;
  activeDragOperationCache.displayZone = DateTime.local().zoneName;
  activeDragOperationCache.isAllDayDrag = !sourceEvent.start_utc;
  if (activeDragOperationCache.view === "year") {
    activeDragOperationCache.overlayHeight = 5;
    activeDragOperationCache.verticalSpacing = 1;
  } else {
    activeDragOperationCache.overlayHeight = 18;
    activeDragOperationCache.verticalSpacing = activeDragOperationCache.view === "month" ? 3 : 2;
  }
  activeDragOperationCache.maxPlacementLevels = 3;

  const preparedSource = prepareEventForPreview(sourceEvent, activeDragOperationCache.displayZone);
  if (!preparedSource._startDt.isValid) {
    cleanupDragState();
    return;
  }

  draggedEventData = {
    eventId,
    originalEventProperties: preparedSource,
    originalDuration: null,
    otherEventsCache: customEvents
      .filter((e) => e.id !== eventId)
      .map((e) => prepareEventForPreview(e, activeDragOperationCache.displayZone))
      .filter((e) => e._startDt.isValid),
    renderedEventLevelsCache: new Map(),
  };

  if (!draggedEventData.originalEventProperties._isAllDay && preparedSource._startDt.isValid && preparedSource._endDt.isValid) {
    draggedEventData.originalDuration = preparedSource._endDt.diff(preparedSource._startDt);
  }

  if (activeDragOperationCache.view === "month" || activeDragOperationCache.view === "year" || ((activeDragOperationCache.view === "week" || activeDragOperationCache.view === "day") && draggedEventData.originalEventProperties._isAllDay)) {
    let contexts = [];
    if (activeDragOperationCache.view === "month" || activeDragOperationCache.view === "year") {
      contexts = Array.from(document.querySelectorAll(".month-card"));
    } else {
      const allDayRow = document.querySelector(`.${activeDragOperationCache.view}-view .week-all-day-row`) || document.querySelector(".week-all-day-row");
      if (allDayRow) contexts = [allDayRow];
    }
    const levelCacheSelector = (activeDragOperationCache.view === "week" || activeDragOperationCache.view === "day") && draggedEventData.originalEventProperties._isAllDay ? `.week-all-day-event-segment[data-event-id][data-level]` : `.event-overlay[data-event-id][data-level]`;
    contexts.forEach((ctx) => {
      ctx.querySelectorAll(levelCacheSelector).forEach((el) => {
        if (el.dataset.eventId !== eventId && !draggedEventData.renderedEventLevelsCache.has(el.dataset.eventId)) {
          draggedEventData.renderedEventLevelsCache.set(el.dataset.eventId, parseInt(el.dataset.level, 10));
        }
      });
    });
  }

  requestAnimationFrame(() => {
    document.querySelectorAll(`[data-event-id="${eventId}"].${EVENT_OVERLAY_CLASS}, [data-event-id="${eventId}"].${WEEK_EVENT_BLOCK_CLASS}, [data-event-id="${eventId}"].${WEEK_ALL_DAY_EVENT_SEGMENT_CLASS}`).forEach((segment) => segment.classList.add(DRAGGING_ORIGINAL_HIDDEN_CLASS));
  });

  document.querySelectorAll(`.${EVENT_OVERLAY_CLASS}, .${WEEK_EVENT_BLOCK_CLASS}, .${WEEK_ALL_DAY_EVENT_SEGMENT_CLASS}`).forEach((el) => {
    if (el.dataset.eventId !== eventId) el.classList.add(IGNORE_POINTER_CLASS);
  });
  document.body.classList.add(IS_DRAGGING_CLASS);

  const initialTargetElement = draggedEventElement.closest(".day[data-date], .week-all-day-slot[data-date], .hour-slot[data-date]");
  const initialTargetInfo = getTargetInfoFromElement(initialTargetElement);
  if (initialTargetInfo) {
    lastValidDropTargetInfo = initialTargetInfo;
    const initialPreviewProps = calculateDroppedEventProperties(draggedEventData.originalEventProperties, initialTargetInfo, activeDragOperationCache.view, activeDragOperationCache.displayZone);
    throttledRenderDragPreview(initialPreviewProps);
  }

  document.addEventListener("touchmove", doc_handleTouchMove, { passive: false });
  document.addEventListener("touchend", doc_handleTouchEnd, { once: true });
  document.addEventListener("touchcancel", doc_handleTouchEnd, { once: true });
}

function getTargetInfoFromElement(element) {
  if (!element) return null;
  const dateString = element.dataset.date;
  if (!dateString) return null;

  const info = { dateString };
  if (element.classList.contains("hour-slot") && element.dataset.time) {
    info.time = element.dataset.time;
    const [hour, minute] = element.dataset.time.split(":").map(Number);
    info.hour = hour;
    info.minute = minute;
  }
  return info;
}

function doc_handleTouchMove(event) {
  if (!draggedEventData || !event.touches || event.touches.length === 0) return;
  event.preventDefault();

  const touch = event.touches[0];
  const elementsUnderFinger = document.elementsFromPoint(touch.clientX, touch.clientY);
  let newDroppableTarget = null;
  for (const el of elementsUnderFinger) {
    if (!el.classList.contains(DRAG_PREVIEW_SEGMENT_CLASS) && !el.classList.contains(WEEK_DRAG_PREVIEW_BLOCK_CLASS)) {
      newDroppableTarget = el.closest(".day:not(.empty-day)[data-date], .week-all-day-slot[data-date], .hour-slot[data-date][data-time]");
      if (newDroppableTarget) break;
    }
  }

  if (currentDroppableTarget && currentDroppableTarget !== newDroppableTarget) {
    currentDroppableTarget.classList.remove(DRAG_OVER_CLASS);
  }
  if (newDroppableTarget && newDroppableTarget !== currentDroppableTarget) {
    newDroppableTarget.classList.add(DRAG_OVER_CLASS);
  }
  currentDroppableTarget = newDroppableTarget;

  if (currentDroppableTarget) {
    lastValidDropTargetInfo = getTargetInfoFromElement(currentDroppableTarget);
  }

  if (lastValidDropTargetInfo) {
    const previewEventProps = calculateDroppedEventProperties(draggedEventData.originalEventProperties, lastValidDropTargetInfo, activeDragOperationCache.view, activeDragOperationCache.displayZone);
    throttledRenderDragPreview(previewEventProps);
  }
}

function doc_handleTouchEnd(event) {
  if (currentDroppableTarget) currentDroppableTarget.classList.remove(DRAG_OVER_CLASS);

  if (draggedEventData && draggedEventData.eventId && lastValidDropTargetInfo) {
    const eventToMove = customEvents.find((e) => e.id === draggedEventData.eventId);
    if (eventToMove) {
      let dropIntentIsAllDay = draggedEventData.originalEventProperties._isAllDay;
      if (currentDroppableTarget) {
        const isDroppedOnHourSlot = currentDroppableTarget.classList.contains("hour-slot");
        const isDroppedOnWeekAllDaySlot = currentDroppableTarget.classList.contains("week-all-day-slot");
        if (isDroppedOnHourSlot) dropIntentIsAllDay = false;
        else if (isDroppedOnWeekAllDaySlot) dropIntentIsAllDay = true;
      }

      updateEventDates(eventToMove, lastValidDropTargetInfo.dateString, lastValidDropTargetInfo.time, dropIntentIsAllDay, draggedEventData.originalDuration);
      if (typeof saveEvents === "function") saveEvents();
      if (typeof window.updateCalendar === "function") window.updateCalendar();
    }
  }
  cleanupDragState();
}

function calculateDroppedEventProperties(originalEventPropsWithLuxon, targetInfo, view, displayZone) {
  const newProps = JSON.parse(JSON.stringify(originalEventPropsWithLuxon));
  const sourceIsAllDay = originalEventPropsWithLuxon._isAllDay;
  const originalStartUtc = originalEventPropsWithLuxon._startDt;
  const originalEndUtc = originalEventPropsWithLuxon._endDt;
  const originalDuration = !sourceIsAllDay && originalStartUtc.isValid && originalEndUtc.isValid ? originalEndUtc.diff(originalStartUtc) : Duration.fromObject({ days: 0 });

  let dropIntentIsAllDay = sourceIsAllDay;

  if (targetInfo.time !== undefined) {
    dropIntentIsAllDay = false;
  } else if (currentDroppableTarget && (view === "week" || view === "day") && currentDroppableTarget.classList.contains("week-all-day-slot")) {
    dropIntentIsAllDay = true;
  }

  if (dropIntentIsAllDay) {
    let currentLocalStart = DateTime.fromISO(targetInfo.dateString, { zone: displayZone }).startOf("day");
    let daysDuration = 0;
    if (sourceIsAllDay && originalStartUtc.isValid && originalEndUtc.isValid) {
      const originalLocalStart = originalStartUtc.setZone(displayZone).startOf("day");
      const originalLocalEnd = originalEndUtc.setZone(displayZone).startOf("day");
      daysDuration = originalLocalEnd.diff(originalLocalStart, "days").days;
    }
    let currentLocalEnd = currentLocalStart.plus({ days: daysDuration }).startOf("day");

    newProps.start = currentLocalStart.toFormat("yyyy-MM-dd");
    newProps.end = currentLocalEnd.toFormat("yyyy-MM-dd");
    delete newProps.time;
    delete newProps.endTime;
    delete newProps.start_utc;
    delete newProps.end_utc;
    delete newProps.startTimezone;
    delete newProps.endTimezone;
  } else {
    const [h, m] = targetInfo.time ? targetInfo.time.split(":").map(Number) : originalEventPropsWithLuxon.time ? originalEventPropsWithLuxon.time.split(":").map(Number) : [0, 0];

    const eventStartTimezone = newProps.startTimezone || displayZone;
    const eventEndTimezone = newProps.endTimezone || displayZone;

    let newStartLocal = DateTime.fromISO(targetInfo.dateString, { zone: eventStartTimezone }).set({ hour: h, minute: m });
    let newEndLocal;

    if (originalDuration.as("milliseconds") > 0) {
      newEndLocal = newStartLocal.plus(originalDuration).setZone(eventEndTimezone);
    } else {
      newEndLocal = newStartLocal.plus({ hours: 1 }).setZone(eventEndTimezone);
    }

    if (newEndLocal <= newStartLocal) newEndLocal = newStartLocal.plus({ hours: 1 }).setZone(eventEndTimezone);

    newProps.start = newStartLocal.toFormat("yyyy-MM-dd");
    newProps.time = newStartLocal.toFormat("HH:mm");
    newProps.start_utc = newStartLocal.toUTC().toISO();

    newProps.end = newEndLocal.toFormat("yyyy-MM-dd");
    newProps.endTime = newEndLocal.toFormat("HH:mm");
    newProps.end_utc = newEndLocal.toUTC().toISO();
    newProps.startTimezone = eventStartTimezone;
    newProps.endTimezone = eventEndTimezone;
  }
  return prepareEventForPreview(newProps, displayZone);
}

function renderDragPreview(previewEventData) {
  clearDragPreview();
  if (!previewEventData || !previewEventData._startDt || !previewEventData._startDt.isValid) return;

  const displayZone = activeDragOperationCache.displayZone;
  const currentView = activeDragOperationCache.view;

  const viewConfigForPreview = {
    displayZone: displayZone,
    overlayHeight: activeDragOperationCache.overlayHeight,
    verticalSpacing: activeDragOperationCache.verticalSpacing,
    maxPlacementLevels: activeDragOperationCache.maxPlacementLevels,
    hourHeightPx: activeDragOperationCache.hourHeightPx,
    viewName: currentView,
  };

  let isColliding = false;
  if (typeof window._findLevelForPreviewSegment === "function" && (currentView === "month" || currentView === "year" || previewEventData._isAllDay) && draggedEventData) {
    const eventStartDisp = previewEventData._startDt.setZone(displayZone);
    let eventEndDisp = previewEventData._endDt.setZone(displayZone);
    if (previewEventData._isAllDay) eventEndDisp = eventEndDisp.startOf("day");
    else if (eventEndDisp.hour === 0 && eventEndDisp.minute === 0 && !eventStartDisp.hasSame(eventEndDisp, "day")) {
      eventEndDisp = eventEndDisp.minus({ days: 1 }).startOf("day");
    } else {
      eventEndDisp = eventEndDisp.startOf("day");
    }
    if (eventEndDisp < eventStartDisp.startOf("day")) eventEndDisp = eventStartDisp.startOf("day");

    const segmentDataForLevel = { segmentStartDt: eventStartDisp.startOf("day"), segmentEndDt: eventEndDisp, _isAllDay: previewEventData._isAllDay, id: previewEventData.id };
    const placementLevel = window._findLevelForPreviewSegment(segmentDataForLevel, draggedEventData.otherEventsCache || [], draggedEventData.renderedEventLevelsCache || new Map(), viewConfigForPreview);
    if (placementLevel >= viewConfigForPreview.maxPlacementLevels) {
      isColliding = true;
    }
  } else if (typeof window.checkBasicResizePreviewCollision === "function" && !previewEventData._isAllDay && (currentView === "week" || currentView === "day") && draggedEventData) {
    isColliding = window.checkBasicResizePreviewCollision(previewEventData, previewEventData.id, currentView, displayZone);
  }

  if (currentView === "month" || currentView === "year") {
    const monthCards = document.querySelectorAll(".month-card");
    monthCards.forEach((monthCard) => {
      const calendarGrid = monthCard.querySelector(".calendar-grid");
      if (!calendarGrid) return;
      const dayElementsInCard = Array.from(calendarGrid.querySelectorAll(".day:not(.empty-day)[data-date]"));
      if (dayElementsInCard.length === 0) return;
      const cardId = monthCard.id;
      const currentCardCellCache = monthCardGeometryCaches.get(cardId);
      if (!currentCardCellCache || currentCardCellCache.size === 0) return;

      const firstGridDt = DateTime.fromISO(dayElementsInCard[0].dataset.date, { zone: displayZone }).startOf("day");
      let gridOffset = DateTime.local(firstGridDt.year, firstGridDt.month, 1, { zone: displayZone }).weekday - 1;
      if (gridOffset < 0) gridOffset = 6;

      const eventStartDisp = previewEventData._startDt.setZone(displayZone);
      let eventEndDisp = previewEventData._endDt.setZone(displayZone);
      let actualVisualLastDayDt = eventEndDisp;
      if (previewEventData._isAllDay) actualVisualLastDayDt = eventEndDisp.startOf("day");
      else {
        if (eventEndDisp.hour === 0 && eventEndDisp.minute === 0 && !eventStartDisp.hasSame(eventEndDisp, "day")) {
          actualVisualLastDayDt = eventEndDisp.minus({ days: 1 }).startOf("day");
        } else {
          actualVisualLastDayDt = eventEndDisp.startOf("day");
        }
      }
      if (actualVisualLastDayDt < eventStartDisp.startOf("day")) actualVisualLastDayDt = eventStartDisp.startOf("day");

      let dayIter = DateTime.max(eventStartDisp.startOf("day"), firstGridDt);
      const cardLastDayDt = DateTime.fromISO(dayElementsInCard[dayElementsInCard.length - 1].dataset.date, { zone: displayZone }).endOf("day");

      while (dayIter <= actualVisualLastDayDt && dayIter <= cardLastDayDt) {
        const segmentStartDate = dayIter;
        const segmentEndDate = DateTime.min(dayIter.endOf("week"), actualVisualLastDayDt, cardLastDayDt);

        let placementLevel = 0;
        if (typeof window._findLevelForPreviewSegment === "function" && draggedEventData) {
          const segmentDataForLevel = { segmentStartDt: segmentStartDate, segmentEndDt: segmentEndDate, _isAllDay: previewEventData._isAllDay, id: previewEventData.id };
          placementLevel = window._findLevelForPreviewSegment(segmentDataForLevel, draggedEventData.otherEventsCache || [], draggedEventData.renderedEventLevelsCache || new Map(), viewConfigForPreview);
        }

        const segmentDiv = createEventSegmentElement(previewEventData, segmentStartDate, segmentEndDate, actualVisualLastDayDt, currentCardCellCache, gridOffset, placementLevel, viewConfigForPreview, true);
        if (segmentDiv) {
          segmentDiv.classList.add(DRAG_PREVIEW_SEGMENT_CLASS);
          if (isColliding || placementLevel >= viewConfigForPreview.maxPlacementLevels) segmentDiv.classList.add(DRAG_PREVIEW_COLLIDING_CLASS);
          monthCard.appendChild(segmentDiv);
        }
        dayIter = segmentEndDate.plus({ days: 1 });
      }
    });
  } else if (currentView === "week" || currentView === "day") {
    const dayColumns = Array.from(document.querySelectorAll(`.${currentView}-view .week-day-column[data-date]`));
    if (dayColumns.length === 0) return;
    const viewStartDt = DateTime.fromISO(dayColumns[0].dataset.date, { zone: displayZone });

    if (previewEventData._isAllDay) {
      const allDayRow = document.querySelector(`.${currentView}-view .week-all-day-row`);
      if (!allDayRow) return;
      const eventStartDay = previewEventData._startDt.setZone(displayZone).startOf("day");
      const eventEndDay = previewEventData._endDt.setZone(displayZone).startOf("day");

      let segmentStartIndex = -1;
      for (let dayIdx = 0; dayIdx < dayColumns.length; dayIdx++) {
        const currentDayInGrid = viewStartDt.plus({ days: dayIdx });
        if (currentDayInGrid >= eventStartDay && currentDayInGrid <= eventEndDay) {
          if (segmentStartIndex === -1) segmentStartIndex = dayIdx;

          if (dayIdx === dayColumns.length - 1 || currentDayInGrid.equals(eventEndDay) || !viewStartDt.plus({ days: dayIdx + 1 }).hasSame(eventEndDay, "day")) {
            const targetAllDaySlotElement = allDayRow.children[segmentStartIndex + 1];
            if (targetAllDaySlotElement) {
              const numDaysInSegment = dayIdx - segmentStartIndex + 1;
              const previewDiv = document.createElement("div");
              previewDiv.className = DRAG_PREVIEW_SEGMENT_CLASS;

              let placementLevel = 0;
              if (typeof window._findLevelForPreviewSegment === "function" && draggedEventData) {
                const segmentDataForLevel = { segmentStartDt: viewStartDt.plus({ days: segmentStartIndex }), segmentEndDt: currentDayInGrid, _isAllDay: true, id: previewEventData.id };
                placementLevel = window._findLevelForPreviewSegment(segmentDataForLevel, draggedEventData.otherEventsCache || [], draggedEventData.renderedEventLevelsCache || new Map(), viewConfigForPreview);
              }
              if (isColliding || placementLevel >= viewConfigForPreview.maxPlacementLevels) previewDiv.classList.add(DRAG_PREVIEW_COLLIDING_CLASS);

              previewDiv.style.backgroundColor = previewEventData.color ? `${previewEventData.color}99` : `rgba(59, 130, 246, 0.6)`;
              previewDiv.style.position = "absolute";
              previewDiv.style.top = `${placementLevel * (viewConfigForPreview.overlayHeight + viewConfigForPreview.verticalSpacing)}px`;
              previewDiv.style.height = `${viewConfigForPreview.overlayHeight}px`;
              previewDiv.style.left = `${targetAllDaySlotElement.offsetLeft}px`;
              const slotWidth = targetAllDaySlotElement.offsetWidth;
              previewDiv.style.width = `${numDaysInSegment * slotWidth - (numDaysInSegment > 1 ? 2 : 0)}px`;
              previewDiv.textContent = previewEventData.name;
              allDayRow.appendChild(previewDiv);
            }
            segmentStartIndex = -1;
          }
        }
      }
    } else {
      dayColumns.forEach((dayColumn, dayIndex) => {
        const currentColumnDay = viewStartDt.plus({ days: dayIndex });
        const eventIntervalUtc = Interval.fromDateTimes(previewEventData._startDt, previewEventData._endDt);
        const columnDayIntervalUtc = Interval.fromDateTimes(currentColumnDay.startOf("day").toUTC(), currentColumnDay.endOf("day").toUTC());

        if (!eventIntervalUtc.overlaps(columnDayIntervalUtc)) return;

        const startDisp = previewEventData._startDt.setZone(displayZone);
        const endDisp = previewEventData._endDt.setZone(displayZone);

        let eventStartHourFraction = 0;
        if (startDisp.hasSame(currentColumnDay, "day")) eventStartHourFraction = startDisp.hour + startDisp.minute / 60;

        let eventEndHourFraction = 24;
        if (endDisp.hasSame(currentColumnDay, "day")) {
          eventEndHourFraction = endDisp.hour + endDisp.minute / 60;
          if (eventEndHourFraction === 0 && startDisp.hasSame(endDisp, "day")) return;
        }
        if (eventEndHourFraction <= eventStartHourFraction && startDisp.hasSame(endDisp, "day")) {
          if (startDisp.equals(endDisp)) return;
          eventEndHourFraction = eventStartHourFraction + 15 / 60;
        }

        const top = eventStartHourFraction * viewConfigForPreview.hourHeightPx;
        let height = (eventEndHourFraction - eventStartHourFraction) * viewConfigForPreview.hourHeightPx;
        if (height <= 1 && height > 0) height = viewConfigForPreview.hourHeightPx / 4;
        if (height <= 0) return;

        const previewBlock = document.createElement("div");
        previewBlock.className = WEEK_DRAG_PREVIEW_BLOCK_CLASS;
        if (isColliding) previewBlock.classList.add(DRAG_PREVIEW_COLLIDING_CLASS);
        previewBlock.style.backgroundColor = previewEventData.color ? `${previewEventData.color}99` : `rgba(59, 130, 246, 0.6)`;
        previewBlock.style.top = `${top}px`;
        previewBlock.style.height = `${Math.max(height - 2, 15)}px`;
        previewBlock.style.left = `0%`;
        previewBlock.style.width = `calc(100% - 4px)`;
        previewBlock.style.marginLeft = `2px`;
        if (currentColumnDay.hasSame(startDisp, "day")) previewBlock.textContent = previewEventData.name;
        dayColumn.appendChild(previewBlock);
      });
    }
  }
}

function updateEventDates(eventToMove, newStartDateCellString, newStartTimeString, dropIntentIsAllDay, originalDuration) {
  const appDisplayTimezone = DateTime.local().zoneName;

  if (dropIntentIsAllDay) {
    let durationDays = 0;
    if (eventToMove.start_utc === undefined && eventToMove.start && eventToMove.end) {
      const originalLocalStart = DateTime.fromISO(eventToMove.start, { zone: appDisplayTimezone }).startOf("day");
      const originalLocalEnd = DateTime.fromISO(eventToMove.end, { zone: appDisplayTimezone }).startOf("day");
      durationDays = originalLocalEnd.diff(originalLocalStart, "days").days;
    }

    const newStartLocal = DateTime.fromISO(newStartDateCellString, { zone: appDisplayTimezone }).startOf("day");
    const newEndLocal = newStartLocal.plus({ days: durationDays }).startOf("day");

    eventToMove.start = newStartLocal.toFormat("yyyy-MM-dd");
    eventToMove.end = newEndLocal.toFormat("yyyy-MM-dd");
    delete eventToMove.time;
    delete eventToMove.endTime;
    delete eventToMove.start_utc;
    delete eventToMove.end_utc;
    delete eventToMove.startTimezone;
    delete eventToMove.endTimezone;
  } else {
    const [h, m] = newStartTimeString ? newStartTimeString.split(":").map(Number) : eventToMove.time ? eventToMove.time.split(":").map(Number) : [0, 0];

    const eventStartTimezone = eventToMove.startTimezone || appDisplayTimezone;
    const eventEndTimezone = eventToMove.endTimezone || appDisplayTimezone;

    let newStartLocal = DateTime.fromISO(newStartDateCellString, { zone: eventStartTimezone }).set({ hour: h, minute: m });
    let newEndLocal;

    if (originalDuration && originalDuration.as("milliseconds") > 0) {
      newEndLocal = newStartLocal.plus(originalDuration).setZone(eventEndTimezone);
    } else {
      newEndLocal = newStartLocal.plus({ hours: 1 }).setZone(eventEndTimezone);
    }
    if (newEndLocal <= newStartLocal) newEndLocal = newStartLocal.plus({ minutes: 15 }).setZone(eventEndTimezone);

    eventToMove.start = newStartLocal.toFormat("yyyy-MM-dd");
    eventToMove.time = newStartLocal.toFormat("HH:mm");
    eventToMove.start_utc = newStartLocal.toUTC().toISO();
    eventToMove.startTimezone = eventStartTimezone;

    eventToMove.end = newEndLocal.toFormat("yyyy-MM-dd");
    eventToMove.endTime = newEndLocal.toFormat("HH:mm");
    eventToMove.end_utc = newEndLocal.toUTC().toISO();
    eventToMove.endTimezone = eventEndTimezone;
  }
}

function cleanupDragState() {
  clearDragPreview();
  const eventIdToUnhide = draggedEventData ? draggedEventData.eventId : draggedEventElement ? draggedEventElement.dataset.eventId : null;

  if (eventIdToUnhide) {
    document.querySelectorAll(`[data-event-id="${eventIdToUnhide}"].${DRAGGING_ORIGINAL_HIDDEN_CLASS}`).forEach((segment) => segment.classList.remove(DRAGGING_ORIGINAL_HIDDEN_CLASS));
  } else if (draggedEventElement) {
    draggedEventElement.classList.remove(DRAGGING_ORIGINAL_HIDDEN_CLASS);
  }

  if (currentDroppableTarget) currentDroppableTarget.classList.remove(DRAG_OVER_CLASS);

  const nativeDragGhost = document.querySelector(`.${DRAG_GHOST_CLASS}`);
  if (nativeDragGhost) nativeDragGhost.remove();

  document.body.classList.remove(IS_DRAGGING_CLASS);
  document.querySelectorAll(`.${IGNORE_POINTER_CLASS}`).forEach((o) => o.classList.remove(IGNORE_POINTER_CLASS));

  document.removeEventListener("touchmove", doc_handleTouchMove, { passive: false });
  document.removeEventListener("touchend", doc_handleTouchEnd);
  document.removeEventListener("touchcancel", doc_handleTouchEnd);

  draggedEventElement = null;
  draggedEventData = null;
  currentDroppableTarget = null;
  lastValidDropTargetInfo = null;

  activeDragOperationCache.view = null;
  activeDragOperationCache.displayZone = null;
}

function addDragAndDropListeners() {
  const currentView = document.getElementById("view-select")?.value || "month";
  let droppableSelector = ".day:not(.empty-day)[data-date]";
  if (currentView === "week" || currentView === "day") {
    droppableSelector = ".week-all-day-slot[data-date], .hour-slot[data-date][data-time]";
  }

  document.querySelectorAll(droppableSelector).forEach((el) => {
    el.removeEventListener("dragenter", handleDayDragEnter);
    el.addEventListener("dragenter", handleDayDragEnter);
    el.removeEventListener("dragover", handleDayDragOver);
    el.addEventListener("dragover", handleDayDragOver);
    el.removeEventListener("dragleave", handleDayDragLeave);
    el.addEventListener("dragleave", handleDayDragLeave);
    el.removeEventListener("drop", handleDayDrop);
    el.addEventListener("drop", handleDayDrop);
  });

  const eventElements = document.querySelectorAll(`.${EVENT_OVERLAY_CLASS}, .${WEEK_EVENT_BLOCK_CLASS}, .${WEEK_ALL_DAY_EVENT_SEGMENT_CLASS}`);
  eventElements.forEach((eventElement) => {
    eventElement.removeEventListener("dragstart", handleDragStart);
    eventElement.addEventListener("dragstart", handleDragStart);
    eventElement.removeEventListener("dragend", handleDragEnd);
    eventElement.addEventListener("dragend", handleDragEnd);
    eventElement.removeEventListener("touchstart", handleTouchStart);
    eventElement.addEventListener("touchstart", handleTouchStart, { passive: false });
  });
}
