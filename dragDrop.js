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
const EVENT_OVERLAY_CLASS = "event-overlay"; // For Month/Year view segments
const WEEK_EVENT_BLOCK_CLASS = "week-event-block"; // For Week view timed events
const WEEK_ALL_DAY_EVENT_SEGMENT_CLASS = "week-all-day-event-segment"; // For Week view all-day events
const DRAG_GHOST_CLASS = "drag-ghost";

function handleDragStart(event) {
  if (window.calendarInteractionState.isResizing) {
    event.preventDefault();
    return;
  }
  if (!event.target.matches(`.${EVENT_OVERLAY_CLASS}, .${WEEK_EVENT_BLOCK_CLASS}, .${WEEK_ALL_DAY_EVENT_SEGMENT_CLASS}`)) {
    return;
  }

  draggedEventElement = event.target;
  const eventId = draggedEventElement.dataset.eventId;
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
    if (el !== draggedEventElement) {
      el.classList.add(IGNORE_POINTER_CLASS);
    }
  });

  if (draggedEventElement) {
    draggedEventElement.style.setProperty("opacity", "0.1", "important");
  }
  document.body.classList.add(IS_DRAGGING_CLASS);

  createAndSetDragGhost(event);
}

function createAndSetDragGhost(event) {
  if (!draggedEventElement) return;
  try {
    dragGhostElement = draggedEventElement.cloneNode(true);
    dragGhostElement.style.opacity = "";
    dragGhostElement.style.visibility = "";
    dragGhostElement.style.pointerEvents = "none";
    dragGhostElement.classList.remove("dragging", IGNORE_POINTER_CLASS);
    dragGhostElement.classList.add(DRAG_GHOST_CLASS);

    Object.assign(dragGhostElement.style, {
      position: "absolute",
      top: "0px",
      left: "-9999px",
      zIndex: "99999",
      width: `${draggedEventElement.offsetWidth}px`,
      height: `${draggedEventElement.offsetHeight}px`,
    });
    document.body.appendChild(dragGhostElement);
    const rect = draggedEventElement.getBoundingClientRect();
    event.dataTransfer.setDragImage(dragGhostElement, event.clientX - rect.left, event.clientY - rect.top);
  } catch (e) {
    if (dragGhostElement) dragGhostElement.remove();
    dragGhostElement = null;
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
      dropIntentIsAllDay = false; // Dropping on an hour slot means it's timed
    } else if (isDroppedOnWeekAllDaySlot) {
      dropIntentIsAllDay = true; // Dropping on week's all-day area means it's all-day
    } else if (isDroppedOnMonthYearDayCell) {
      // If dropped on a month/year day cell, it takes on the characteristic of the source event.
      // If source was timed, it remains timed (but date changes).
      // If source was all-day, it remains all-day.
      dropIntentIsAllDay = draggedEventData.isAllDay;
    } else {
      // Should not happen with current target matching in dragEnter/dragOver
      dropIntentIsAllDay = draggedEventData.isAllDay; // Fallback
    }

    const newTime = dropTarget.dataset.time; // e.g., "09:00", only for .hour-slot

    updateEventDates(eventToMove, newDateCellString, newTime, dropIntentIsAllDay, draggedEventData.originalDuration);

    if (typeof saveEvents === "function") saveEvents();
    if (typeof window.renderEventVisuals === "function") {
      requestAnimationFrame(window.renderEventVisuals);
    }
  }
  cleanupDragState();
}

function updateEventDates(eventToMove, newStartDateCellString, newStartTimeString, dropIntentIsAllDay, originalDuration) {
  const appDisplayTimezone = DateTime.local().zoneName;
  // isOriginallyAllDay refers to the state of eventToMove *before* this update function modifies it.
  // We use draggedEventData.isAllDay for the state of the event at the start of the drag operation.
  const wasSourceEventAllDay = draggedEventData.isAllDay;

  if (dropIntentIsAllDay) {
    // Event will become (or stay) all-day.
    let durationDays;
    if (wasSourceEventAllDay) {
      // If original was all-day, preserve its day-based duration
      const originalStartDt = DateTime.fromISO(eventToMove.start, { zone: appDisplayTimezone });
      const originalEndDt = DateTime.fromISO(eventToMove.end, { zone: appDisplayTimezone });
      durationDays = originalEndDt.diff(originalStartDt, "days").days;
    } else {
      // If original was timed, new all-day event defaults to single day.
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
    // Event will become (or stay) timed.
    // If newStartTimeString is provided (e.g., dropped on an hour slot), use it.
    // Otherwise, preserve the event's original time.
    const [h, m] = newStartTimeString ? newStartTimeString.split(":").map(Number) : eventToMove.time ? eventToMove.time.split(":").map(Number) : [0, 0];

    const eventStartTimezone = eventToMove.startTimezone || appDisplayTimezone;
    const eventEndTimezone = eventToMove.endTimezone || appDisplayTimezone;

    let newStartLocalDt = DateTime.fromISO(newStartDateCellString, { zone: eventStartTimezone }).set({ hour: h, minute: m });

    let currentEventDuration = originalDuration; // Use the duration from the start of the drag.
    if (!currentEventDuration) {
      // If originalDuration was null (e.g. source was all-day or had no duration)
      currentEventDuration = Duration.fromObject({ hours: 1 }); // Default to 1 hour
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
  if (draggedEventElement) {
    draggedEventElement.style.opacity = "";
    draggedEventElement.style.visibility = "";
    draggedEventElement.classList.remove("dragging");
  }
  if (currentDroppableTarget) {
    currentDroppableTarget.classList.remove(DRAG_OVER_CLASS);
  }
  if (dragGhostElement) {
    dragGhostElement.remove();
  }
  document.body.classList.remove(IS_DRAGGING_CLASS);
  document.body.classList.remove("is-resizing-active");
  document.querySelectorAll(`.${IGNORE_POINTER_CLASS}`).forEach((overlay) => {
    overlay.classList.remove(IGNORE_POINTER_CLASS);
  });
  draggedEventElement = null;
  draggedEventData = null;
  currentDroppableTarget = null;
  dragGhostElement = null;
  if (window.calendarInteractionState) {
    window.calendarInteractionState.isResizing = false;
  }
}

function addDragAndDropListeners() {
  const currentView = document.getElementById("view-select") ? document.getElementById("view-select").value : "month";
  let droppableElements;

  if (currentView === "week") {
    droppableElements = document.querySelectorAll(".week-all-day-slot[data-date], .hour-slot[data-date][data-time]");
  } else {
    // year or month view
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
