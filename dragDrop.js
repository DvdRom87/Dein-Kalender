if (typeof window.calendarInteractionState === "undefined") {
  window.calendarInteractionState = { isResizing: false };
}

let draggedEventElement = null;
let draggedEventData = null;
let currentDroppableTarget = null;
let dragGhostElement = null;

const { DateTime, Duration } = luxon;

const IGNORE_POINTER_CLASS = "ignore-pointer-during-drag";
const DRAG_OVER_CLASS = "drag-over";
const IS_DRAGGING_CLASS = "is-dragging-active";
const EVENT_OVERLAY_CLASS = "event-overlay";
const WEEK_EVENT_BLOCK_CLASS = "week-event-block";
const WEEK_ALL_DAY_EVENT_SEGMENT_CLASS = "week-all-day-event-segment";
const DRAG_GHOST_CLASS = "drag-ghost";
const DRAGGING_ORIGINAL_HIDDEN_CLASS = "dragging-original-hidden";

function handleDragStart(event) {
  if (window.calendarInteractionState.isResizing) {
    event.preventDefault();
    return;
  }
  const targetEventElement = event.target.closest(`.${EVENT_OVERLAY_CLASS}, .${WEEK_EVENT_BLOCK_CLASS}, .${WEEK_ALL_DAY_EVENT_SEGMENT_CLASS}`);
  if (!targetEventElement) {
    return;
  }

  draggedEventElement = targetEventElement;
  const eventId = draggedEventElement.dataset.eventId;
  if (!eventId) return;

  const sourceEvent = Array.isArray(customEvents) ? customEvents.find((e) => e.id === eventId) : null;

  if (!sourceEvent) {
    event.preventDefault();
    cleanupDragState();
    return;
  }

  draggedEventData = {
    eventId,
    isAllDay: !sourceEvent.start_utc,
    originalDuration: null,
  };

  if (!draggedEventData.isAllDay && sourceEvent.start_utc && sourceEvent.end_utc) {
    const startUtc = DateTime.fromISO(sourceEvent.start_utc, { zone: "utc" });
    const endUtc = DateTime.fromISO(sourceEvent.end_utc, { zone: "utc" });
    if (startUtc.isValid && endUtc.isValid) {
      draggedEventData.originalDuration = endUtc.diff(startUtc);
    }
  }

  try {
    event.dataTransfer.setData("text/plain", eventId);
    event.dataTransfer.effectAllowed = "move";
  } catch (e) {
    try {
      event.dataTransfer.setData("text", eventId);
      event.dataTransfer.effectAllowed = "move";
    } catch (e2) {
      console.error("Drag and drop setData failed: ", e2);
      event.preventDefault();
      cleanupDragState();
      return;
    }
  }

  document.querySelectorAll(`.${EVENT_OVERLAY_CLASS}, .${WEEK_EVENT_BLOCK_CLASS}, .${WEEK_ALL_DAY_EVENT_SEGMENT_CLASS}`).forEach((el) => {
    if (el.dataset.eventId !== eventId) {
      el.classList.add(IGNORE_POINTER_CLASS);
    }
  });

  document.body.classList.add(IS_DRAGGING_CLASS);

  const ghostSucceeded = createAndSetDragGhost(event);

  if (ghostSucceeded) {
    requestAnimationFrame(() => {
      document.querySelectorAll(`.${EVENT_OVERLAY_CLASS}[data-event-id="${eventId}"], ` + `.${WEEK_EVENT_BLOCK_CLASS}[data-event-id="${eventId}"], ` + `.${WEEK_ALL_DAY_EVENT_SEGMENT_CLASS}[data-event-id="${eventId}"]`).forEach((segment) => {
        segment.classList.add(DRAGGING_ORIGINAL_HIDDEN_CLASS);
      });
    });
  } else {
    console.warn("Drag ghost creation failed, drag might not work as expected.");
  }
}

function createAndSetDragGhost(event) {
  if (!draggedEventElement) return false;

  dragGhostElement = draggedEventElement.cloneNode(true);

  dragGhostElement.style.opacity = "";
  dragGhostElement.style.visibility = "visible";
  dragGhostElement.style.display = "";
  dragGhostElement.style.pointerEvents = "none";

  dragGhostElement.classList.remove(DRAGGING_ORIGINAL_HIDDEN_CLASS);
  dragGhostElement.classList.remove(IGNORE_POINTER_CLASS);
  dragGhostElement.classList.add(DRAG_GHOST_CLASS);

  Object.assign(dragGhostElement.style, {
    position: "absolute",
    top: "-9999px",
    left: "-9999px",
    zIndex: "99999",
    width: `${draggedEventElement.offsetWidth}px`,
    height: `${draggedEventElement.offsetHeight}px`,
  });

  document.body.appendChild(dragGhostElement);

  try {
    const rect = draggedEventElement.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;

    event.dataTransfer.setDragImage(dragGhostElement, offsetX, offsetY);
    return true;
  } catch (e) {
    console.error("Error in setDragImage:", e);
    if (dragGhostElement) dragGhostElement.remove();
    dragGhostElement = null;
    return false;
  }
}

function handleDayDragEnter(event) {
  if (!draggedEventData) return;
  const targetElement = event.currentTarget;
  if (!targetElement.matches(".day:not(.empty-day)[data-date], .week-all-day-slot[data-date], .hour-slot[data-date][data-time]")) return;

  if (currentDroppableTarget && currentDroppableTarget !== targetElement) {
    currentDroppableTarget.classList.remove(DRAG_OVER_CLASS);
  }
  targetElement.classList.add(DRAG_OVER_CLASS);
  currentDroppableTarget = targetElement;
}

function handleDayDragOver(event) {
  event.preventDefault();
  const targetElement = event.currentTarget;
  if (!targetElement.matches(".day:not(.empty-day)[data-date], .week-all-day-slot[data-date], .hour-slot[data-date][data-time]")) {
    event.dataTransfer.dropEffect = "none";
    return;
  }
  event.dataTransfer.dropEffect = draggedEventData ? "move" : "none";
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

  const newDateCellString = dropTarget.dataset.date;
  const eventToMove = customEvents.find((e) => e.id === draggedEventData.eventId);

  if (eventToMove && newDateCellString) {
    const isDroppedOnWeekAllDaySlot = dropTarget.classList.contains("week-all-day-slot");
    const isDroppedOnHourSlot = dropTarget.classList.contains("hour-slot");
    const isDroppedOnMonthYearDayCell = dropTarget.classList.contains("day") && !isDroppedOnHourSlot && !isDroppedOnWeekAllDaySlot;

    let dropIntentIsAllDay;

    if (isDroppedOnHourSlot) {
      dropIntentIsAllDay = false;
    } else if (isDroppedOnWeekAllDaySlot) {
      dropIntentIsAllDay = true;
    } else if (isDroppedOnMonthYearDayCell) {
      dropIntentIsAllDay = draggedEventData.isAllDay;
    } else {
      dropIntentIsAllDay = draggedEventData.isAllDay;
    }

    const newTime = dropTarget.dataset.time;

    updateEventDates(eventToMove, newDateCellString, newTime, dropIntentIsAllDay, draggedEventData.originalDuration);

    if (typeof saveEvents === "function") saveEvents();
    if (typeof window.updateCalendar === "function") {
      window.updateCalendar();
    } else if (typeof window.renderEventVisuals === "function") {
      requestAnimationFrame(window.renderEventVisuals);
    }
  }
  cleanupDragState();
}

function updateEventDates(eventToMove, newStartDateCellString, newStartTimeString, dropIntentIsAllDay, originalDuration) {
  const appDisplayTimezone = DateTime.local().zoneName;
  const wasSourceEventAllDay = draggedEventData.isAllDay;

  if (dropIntentIsAllDay) {
    let durationDays;
    if (wasSourceEventAllDay) {
      const originalStartDt = DateTime.fromISO(eventToMove.start, { zone: appDisplayTimezone });
      const originalEndDt = DateTime.fromISO(eventToMove.end, { zone: appDisplayTimezone });
      durationDays = originalEndDt.diff(originalStartDt, "days").days;
    } else {
      durationDays = 0;
    }

    const newStartDt = DateTime.fromISO(newStartDateCellString, { zone: appDisplayTimezone }).startOf("day");
    const newEndDt = newStartDt.plus({ days: durationDays }).endOf("day");

    eventToMove.start = newStartDt.toFormat("yyyy-MM-dd");
    eventToMove.end = newEndDt.toFormat("yyyy-MM-dd");
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

    let newStartLocalDt = DateTime.fromISO(newStartDateCellString, { zone: eventStartTimezone }).set({ hour: h, minute: m });

    let currentEventDuration = originalDuration;
    if (!currentEventDuration) {
      currentEventDuration = Duration.fromObject({ hours: 1 });
    }

    const newStartUtcDt = newStartLocalDt.toUTC();
    const newEndUtcDt = newStartUtcDt.plus(currentEventDuration);
    const finalNewEndLocal = newEndUtcDt.setZone(eventEndTimezone);

    eventToMove.start = newStartLocalDt.toFormat("yyyy-MM-dd");
    eventToMove.time = newStartLocalDt.toFormat("HH:mm");
    eventToMove.end = finalNewEndLocal.toFormat("yyyy-MM-dd");
    eventToMove.endTime = finalNewEndLocal.toFormat("HH:mm");
    eventToMove.start_utc = newStartUtcDt.toISO();
    eventToMove.end_utc = newEndUtcDt.toISO();
    eventToMove.startTimezone = eventStartTimezone;
    eventToMove.endTimezone = eventEndTimezone;
  }
}

function handleDragEnd(event) {
  cleanupDragState();
}

function cleanupDragState() {
  // Use draggedEventData.eventId if draggedEventElement might be gone or null
  const eventIdToUnhide = draggedEventData ? draggedEventData.eventId : null;

  if (eventIdToUnhide) {
    document.querySelectorAll(`.${EVENT_OVERLAY_CLASS}[data-event-id="${eventIdToUnhide}"], ` + `.${WEEK_EVENT_BLOCK_CLASS}[data-event-id="${eventIdToUnhide}"], ` + `.${WEEK_ALL_DAY_EVENT_SEGMENT_CLASS}[data-event-id="${eventIdToUnhide}"]`).forEach((segment) => {
      segment.classList.remove(DRAGGING_ORIGINAL_HIDDEN_CLASS);
    });
  } else if (draggedEventElement) {
    // Fallback if eventIdToUnhide is not available
    draggedEventElement.classList.remove(DRAGGING_ORIGINAL_HIDDEN_CLASS);
  }

  if (currentDroppableTarget) {
    currentDroppableTarget.classList.remove(DRAG_OVER_CLASS);
  }
  if (dragGhostElement) {
    dragGhostElement.remove();
  }
  document.body.classList.remove(IS_DRAGGING_CLASS);

  document.querySelectorAll(`.${IGNORE_POINTER_CLASS}`).forEach((overlay) => {
    overlay.classList.remove(IGNORE_POINTER_CLASS);
  });

  draggedEventElement = null;
  draggedEventData = null;
  currentDroppableTarget = null;
  dragGhostElement = null;
}

function addDragAndDropListeners() {
  const currentView = document.getElementById("view-select") ? document.getElementById("view-select").value : "month";
  let droppableElements;

  if (currentView === "week" || currentView === "day") {
    droppableElements = document.querySelectorAll(".week-all-day-slot[data-date], .hour-slot[data-date][data-time]");
  } else {
    droppableElements = document.querySelectorAll(".day:not(.empty-day)[data-date]");
  }

  droppableElements.forEach((el) => {
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
  });
}
