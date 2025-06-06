// --- START OF FILE eventRenderer.js ---

const domElementPool = {
  pools: {
    eventOverlay: [],
    weekAllDaySegment: [],
    weekTimedBlock: [],
    countBox: [],
  },
  maxElementsPerPool: 50,
};

function getElementFromPool(type) {
  const pool = domElementPool.pools[type];
  if (pool && pool.length > 0) {
    const el = pool.pop();
    el.style.display = "";
    return el;
  }
  const newEl = document.createElement("div");
  return newEl;
}

function releaseElementToPool(element, type) {
  if (!element || !type || !domElementPool.pools[type]) return;

  element.className = "";
  element.style.cssText = "";
  element.textContent = "";
  element.removeAttribute("data-event-id");
  element.removeAttribute("data-level");
  element.removeAttribute("draggable");
  element.style.display = "none";

  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }

  if (element.onclick) element.onclick = null;

  const pool = domElementPool.pools[type];
  if (pool.length < domElementPool.maxElementsPerPool) {
    pool.push(element);
  } else {
    element.remove();
  }
}
// --- End of Object Pooling System ---

const activeRenderCache = {
  allDaySlotGeometries: new Map(),
};

function calculateEventSegmentBaseTop(cellGeom, placementLevel, viewConfig) {
  return cellGeom.top + cellGeom.height - placementLevel * (viewConfig.overlayHeight + viewConfig.verticalSpacing) - viewConfig.overlayHeight - (viewConfig.viewName === "year" ? 1 : 2);
}

function clearEventOverlaysAndCountBoxes() {
  document.querySelectorAll(".event-overlay").forEach((el) => releaseElementToPool(el, "eventOverlay"));
  document.querySelectorAll(".event-count-box").forEach((el) => releaseElementToPool(el, "countBox"));
  document.querySelectorAll(".resize-preview-segment, .drag-preview-segment").forEach((el) => el.remove());
  document.querySelectorAll(".week-event-block").forEach((el) => releaseElementToPool(el, "weekTimedBlock"));
  document.querySelectorAll(".week-all-day-event-segment").forEach((el) => releaseElementToPool(el, "weekAllDaySegment"));
}
window.clearEventOverlaysAndCountBoxes = clearEventOverlaysAndCountBoxes;

function createEventSegmentElement(eventData, segmentStartDt, segmentEndDt, actualVisualLastDayDt, cellGeometryCache, startOffsetInGrid, placementLevel, viewConfig, isPreview = false) {
  // Ensure all critical DateTime inputs are valid
  if (!eventData._startDt || !eventData._startDt.isValid || !eventData._endDt || !eventData._endDt.isValid || !segmentStartDt || !segmentStartDt.isValid || !segmentEndDt || !segmentEndDt.isValid || !actualVisualLastDayDt || !actualVisualLastDayDt.isValid) {
    console.error("Invalid DateTime in createEventSegmentElement params for event:", eventData.id, {
      _startDt_val: eventData._startDt?.isValid,
      _endDt_val: eventData._endDt?.isValid,
      segmentStartDt_val: segmentStartDt?.isValid,
      segmentEndDt_val: segmentEndDt?.isValid,
      actualVisualLastDayDt_val: actualVisualLastDayDt?.isValid,
    });
    return null;
  }

  const isAllDayEvent = eventData._isAllDay;
  const eventStartInDisplayZone = eventData._startDt.setZone(viewConfig.displayZone);
  const eventEndInDisplayZone = eventData._endDt.setZone(viewConfig.displayZone);

  if (!eventStartInDisplayZone.isValid || !eventEndInDisplayZone.isValid) {
    console.error("Invalid DateTime after zone conversion in createEventSegmentElement for event:", eventData.id);
    return null;
  }

  const isTrueEventStart = segmentStartDt.hasSame(eventStartInDisplayZone, "day");
  const isTrueEventEnd = segmentEndDt.hasSame(actualVisualLastDayDt, "day");
  const startCellPos = String(startOffsetInGrid + segmentStartDt.day - 1);
  const endCellPos = String(startOffsetInGrid + segmentEndDt.day - 1);
  const segmentStartCellGeom = cellGeometryCache.get(startCellPos);
  const segmentEndCellGeom = cellGeometryCache.get(endCellPos);

  if (!segmentStartCellGeom || !segmentEndCellGeom) {
    return null;
  }

  const segmentDiv = isPreview ? document.createElement("div") : getElementFromPool("eventOverlay");

  if (isPreview) {
    segmentDiv.className = "resize-preview-segment";
    segmentDiv.style.backgroundColor = eventData.color ? `${eventData.color}99` : `rgba(59, 130, 246, 0.6)`;
  } else {
    segmentDiv.className = "event-overlay";
    segmentDiv.style.backgroundColor = eventData.color || "#3b82f6";
    if (isTrueEventStart) segmentDiv.classList.add("event-overlay-start");
    if (isTrueEventEnd) segmentDiv.classList.add("event-overlay-end");

    if (typeof openModal === "function") {
      segmentDiv.onclick = (e) => {
        e.stopPropagation();
        openModal("form", eventData.id);
      };
    }
  }

  let renderStartFrac = eventData._startFraction !== undefined && isTrueEventStart && !isAllDayEvent ? eventData._startFraction : 0.0;
  let renderEndFrac = eventData._endFraction !== undefined && isTrueEventEnd && !isAllDayEvent ? eventData._endFraction : 1.0;

  if (!isAllDayEvent) {
    if (isTrueEventStart && eventData._startFraction === undefined) {
      renderStartFrac = DateUtils.timeToFraction(eventStartInDisplayZone.toFormat("HH:mm")) ?? 0.0;
    }
    if (isTrueEventEnd && eventData._endFraction === undefined) {
      const endLocalTime = eventEndInDisplayZone.toFormat("HH:mm");
      if (endLocalTime === "00:00" && !eventStartInDisplayZone.hasSame(eventEndInDisplayZone, "day")) {
        renderEndFrac = 1.0;
      } else {
        renderEndFrac = DateUtils.timeToFraction(endLocalTime) ?? 1.0;
      }
    }
  }

  if (!isAllDayEvent && segmentStartDt.hasSame(segmentEndDt, "day") && renderEndFrac <= renderStartFrac) {
    if (renderEndFrac === 0 && renderStartFrac === 0 && eventStartInDisplayZone.equals(eventEndInDisplayZone)) {
      if (!isPreview) releaseElementToPool(segmentDiv, "eventOverlay");
      return null;
    }
    renderEndFrac = Math.min(1.0, renderStartFrac + 5 / (24 * 60));
  }

  let left = segmentStartCellGeom.left + renderStartFrac * segmentStartCellGeom.width;
  let right = segmentEndCellGeom.left + renderEndFrac * segmentEndCellGeom.width;

  if (!segmentStartDt.hasSame(segmentEndDt, "day")) {
    left = isTrueEventStart && !isAllDayEvent ? segmentStartCellGeom.left + renderStartFrac * segmentStartCellGeom.width : segmentStartCellGeom.left;
    right = isTrueEventEnd && !isAllDayEvent && renderEndFrac !== 1.0 ? segmentEndCellGeom.left + renderEndFrac * segmentEndCellGeom.width : segmentEndCellGeom.right;
  }

  let width = Math.max(0, right - left);
  if (width > 1 && !isPreview) width -= 1;
  width = Math.max(isPreview ? 3 : 0.5, width);

  const top = calculateEventSegmentBaseTop(segmentStartCellGeom, placementLevel, viewConfig);

  segmentDiv.style.left = `${left}px`;
  segmentDiv.style.top = `${top - 2}px`;
  segmentDiv.style.width = `${width}px`;
  segmentDiv.style.height = `${viewConfig.overlayHeight}px`;

  if (!isPreview && viewConfig.viewName !== "year" && width > 15) {
    const nameSpan = document.createElement("span");
    nameSpan.className = "event-overlay-name";
    nameSpan.textContent = eventData.name;
    segmentDiv.appendChild(nameSpan);
  }
  segmentDiv.dataset.eventId = eventData.id;
  segmentDiv.dataset.level = placementLevel;
  return segmentDiv;
}
window.createEventSegmentElement = createEventSegmentElement;

function renderMonthYearViewEvents(eventsToRender, viewConfig) {
  const levelsOccupiedPerDay = new Map();
  const hiddenEventsPerDay = new Map();
  const drawnEventDaySegments = new Set();

  const ensureDayStructure = (dateString) => {
    if (!levelsOccupiedPerDay.has(dateString)) {
      levelsOccupiedPerDay.set(
        dateString,
        Array.from({ length: viewConfig.maxPlacementLevels }, () => [])
      );
    }
  };

  const monthCards = calendarContainer.querySelectorAll(".month-card");
  monthCards.forEach((monthCard) => {
    const grid = monthCard.querySelector(".calendar-grid");
    if (!grid) return;
    const dayEls = Array.from(grid.querySelectorAll(".day:not(.empty-day)[data-date]"));
    if (dayEls.length === 0) return;

    const cellCache = monthCardGeometryCaches.get(monthCard.id);
    if (!cellCache || cellCache.size === 0) return;

    const overlaysFrag = document.createDocumentFragment();
    const countsFrag = document.createDocumentFragment();

    const firstGridDt = luxon.DateTime.fromISO(dayEls[0].dataset.date, { zone: viewConfig.displayZone }).startOf("day");
    const lastGridDt = luxon.DateTime.fromISO(dayEls[dayEls.length - 1].dataset.date, { zone: viewConfig.displayZone }).endOf("day");

    let gridOffset = luxon.DateTime.local(firstGridDt.year, firstGridDt.month, 1, { zone: viewConfig.displayZone }).weekday - 1;
    if (gridOffset < 0) gridOffset = 6;

    const cardEvents = eventsToRender.filter((event) => {
      if (!event._startDt || !event._startDt.isValid || !event._endDt || !event._endDt.isValid) return false;
      const eventStartDisp = event._startDt.setZone(viewConfig.displayZone);
      const eventEndDisp = luxon.DateTime.max(eventStartDisp, event._endDt.setZone(viewConfig.displayZone));
      if (!eventStartDisp.isValid || !eventEndDisp.isValid) return false;
      const eventInterval = luxon.Interval.fromDateTimes(eventStartDisp, eventEndDisp);
      const cardInterval = luxon.Interval.fromDateTimes(firstGridDt, lastGridDt);
      return eventInterval.overlaps(cardInterval);
    });

    cardEvents.forEach((event) => {
      if (!event._startDt || !event._startDt.isValid || !event._endDt || !event._endDt.isValid) {
        console.warn("Skipping event in renderMonthYearViewEvents (cardEvents.forEach) due to invalid _startDt or _endDt:", event.id);
        return;
      }

      const startDisp = event._startDt.setZone(viewConfig.displayZone);
      const endDisp = event._endDt.setZone(viewConfig.displayZone);

      if (!startDisp.isValid || !endDisp.isValid) {
        console.warn("Skipping event due to invalid startDisp or endDisp after zone conversion (cardEvents.forEach):", event.id);
        return;
      }

      let actualVisualLastDayDt = endDisp;
      if (event._isAllDay) {
        actualVisualLastDayDt = endDisp.startOf("day");
      } else {
        if (endDisp.hour === 0 && endDisp.minute === 0 && endDisp.second === 0 && !startDisp.hasSame(endDisp, "day")) {
          actualVisualLastDayDt = endDisp.minus({ days: 1 }).startOf("day");
        } else {
          actualVisualLastDayDt = endDisp.startOf("day");
        }
      }
      if (!actualVisualLastDayDt.isValid) {
        console.warn("actualVisualLastDayDt became invalid for event (cardEvents.forEach):", event.id);
        return;
      }
      if (actualVisualLastDayDt < startDisp.startOf("day")) {
        actualVisualLastDayDt = startDisp.startOf("day");
      }

      let dayIter = luxon.DateTime.max(startDisp.startOf("day"), firstGridDt);
      while (dayIter.isValid && dayIter <= actualVisualLastDayDt && dayIter <= lastGridDt) {
        const dayStr = dayIter.toFormat("yyyy-MM-dd");
        const eventDayKey = `${event.id}-${dayStr}`;
        if (drawnEventDaySegments.has(eventDayKey)) {
          dayIter = dayIter.plus({ days: 1 });
          continue;
        }

        let placementLvl = -1;
        let currentSegmentEndDt = dayIter;
        let currentDayStartFraction = event._isAllDay ? 0.0 : event._startFraction !== undefined && dayIter.hasSame(startDisp, "day") ? event._startFraction : DateUtils.timeToFraction(startDisp.toFormat("HH:mm")) ?? 0.0;
        let currentDayEndFraction = event._isAllDay ? 1.0 : event._endFraction !== undefined && dayIter.hasSame(actualVisualLastDayDt, "day") ? event._endFraction : 1.0;

        if (!event._isAllDay && dayIter.hasSame(endDisp.startOf("day"), "day") && event._endFraction === undefined) {
          const endLocalTime = endDisp.toFormat("HH:mm");
          if (endLocalTime === "00:00" && !startDisp.hasSame(endDisp, "day")) currentDayEndFraction = 1.0;
          else currentDayEndFraction = DateUtils.timeToFraction(endLocalTime) ?? 1.0;
        }
        if (!event._isAllDay && dayIter.hasSame(startDisp, "day") && dayIter.hasSame(endDisp.startOf("day"), "day") && currentDayEndFraction <= currentDayStartFraction) {
          if (startDisp.equals(endDisp)) {
            dayIter = dayIter.plus({ days: 1 });
            continue;
          }
          currentDayEndFraction = Math.min(1.0, currentDayStartFraction + 5 / (24 * 60));
        }

        for (let lvlIdx = 0; lvlIdx < viewConfig.maxPlacementLevels; lvlIdx++) {
          ensureDayStructure(dayStr);
          const occupiedSlotsOnLevel = levelsOccupiedPerDay.get(dayStr)[lvlIdx];
          const conflictsOnLevel = occupiedSlotsOnLevel.some((slot) => Math.max(currentDayStartFraction, slot.startFraction) < Math.min(currentDayEndFraction, slot.endFraction) && currentDayEndFraction > currentDayStartFraction);

          if (!conflictsOnLevel) {
            placementLvl = lvlIdx;
            let nextDayInSegment = dayIter.plus({ days: 1 });
            const endOfWeekForIter = dayIter.endOf("week"); // Assuming Monday is start of week per Luxon default/ISO
            const maxPossibleExtensionEnd = luxon.DateTime.min(actualVisualLastDayDt, endOfWeekForIter, lastGridDt);

            while (nextDayInSegment.isValid && nextDayInSegment <= maxPossibleExtensionEnd) {
              if (!startDisp.isValid || !endDisp.isValid || !actualVisualLastDayDt.isValid) {
                // Re-check critical dates
                console.error("CRITICAL: DateTime became invalid during segment extension", { eventId: event.id });
                break;
              }
              const nextDayStr = nextDayInSegment.toFormat("yyyy-MM-dd");
              if (drawnEventDaySegments.has(`${event.id}-${nextDayStr}`)) break;
              ensureDayStructure(nextDayStr);

              let nextDayStartFracForCollision = 0.0;
              let nextDayEndFracForCollision = 1.0;
              if (!event._isAllDay) {
                if (nextDayInSegment.hasSame(startDisp, "day")) {
                  nextDayStartFracForCollision = event._startFraction ?? DateUtils.timeToFraction(startDisp.toFormat("HH:mm")) ?? 0.0;
                } else {
                  nextDayStartFracForCollision = 0.0;
                }

                if (nextDayInSegment.hasSame(actualVisualLastDayDt, "day")) {
                  const endLocalTime = endDisp.toFormat("HH:mm");
                  if (endLocalTime === "00:00" && !startDisp.hasSame(endDisp, "day")) {
                    nextDayEndFracForCollision = 1.0;
                  } else {
                    nextDayEndFracForCollision = event._endFraction ?? DateUtils.timeToFraction(endLocalTime) ?? 1.0;
                  }
                } else {
                  nextDayEndFracForCollision = 1.0;
                }

                if (nextDayInSegment.hasSame(startDisp, "day") && nextDayInSegment.hasSame(actualVisualLastDayDt, "day") && nextDayEndFracForCollision <= nextDayStartFracForCollision) {
                  if (!startDisp.equals(endDisp)) {
                    nextDayEndFracForCollision = Math.min(1.0, nextDayStartFracForCollision + 5 / (24 * 60));
                  }
                }
              }
              const nextDayOccupiedSlots = levelsOccupiedPerDay.get(nextDayStr)[placementLvl];
              const conflictsOnNextDayThisLevel = nextDayOccupiedSlots.some((slot) => Math.max(nextDayStartFracForCollision, slot.startFraction) < Math.min(nextDayEndFracForCollision, slot.endFraction) && (nextDayEndFracForCollision > nextDayStartFracForCollision || (event._isAllDay && slot.isAllDay)));

              if (conflictsOnNextDayThisLevel) break;
              currentSegmentEndDt = nextDayInSegment;
              nextDayInSegment = nextDayInSegment.plus({ days: 1 });
            }
            break;
          }
        }

        if (placementLvl !== -1) {
          const segmentDiv = getElementFromPool("eventOverlay");
          segmentDiv.className = "event-overlay";
          segmentDiv.style.backgroundColor = event.color || "#3b82f6";
          const isTrueEventStart = dayIter.hasSame(startDisp, "day");
          const isTrueEventEnd = currentSegmentEndDt.hasSame(actualVisualLastDayDt, "day");
          if (isTrueEventStart) segmentDiv.classList.add("event-overlay-start");
          if (isTrueEventEnd) segmentDiv.classList.add("event-overlay-end");

          segmentDiv.onclick = (e) => {
            e.stopPropagation();
            openModal("form", event.id);
          };

          let rStartFrac = isTrueEventStart && !event._isAllDay ? event._startFraction ?? DateUtils.timeToFraction(startDisp.toFormat("HH:mm")) ?? 0.0 : 0.0;
          let rEndFrac = 1.0;
          if (currentSegmentEndDt.hasSame(actualVisualLastDayDt, "day") && !event._isAllDay) {
            const endLocalTime = endDisp.toFormat("HH:mm");
            if (endLocalTime === "00:00" && !startDisp.hasSame(endDisp, "day")) {
              rEndFrac = 1.0;
            } else {
              rEndFrac = event._endFraction ?? DateUtils.timeToFraction(endLocalTime) ?? 1.0;
            }
          } else if (currentSegmentEndDt.hasSame(dayIter, "day") && !event._isAllDay) {
            rEndFrac = currentDayEndFraction;
          }

          const startCellPos = String(gridOffset + dayIter.day - 1);
          const endCellPos = String(gridOffset + currentSegmentEndDt.day - 1);
          const segmentStartCellGeom = cellCache.get(startCellPos);
          const segmentEndCellGeom = cellCache.get(endCellPos);

          if (segmentStartCellGeom && segmentEndCellGeom) {
            let left = segmentStartCellGeom.left + (isTrueEventStart && !event._isAllDay ? rStartFrac * segmentStartCellGeom.width : 0);
            let right = segmentEndCellGeom.left + (currentSegmentEndDt.hasSame(dayIter, "day") && !event._isAllDay ? rEndFrac * segmentEndCellGeom.width : isTrueEventEnd && !event._isAllDay && rEndFrac !== 1.0 ? rEndFrac * segmentEndCellGeom.width : segmentEndCellGeom.width);

            if (!dayIter.hasSame(currentSegmentEndDt, "day")) {
              left = isTrueEventStart && !event._isAllDay ? segmentStartCellGeom.left + rStartFrac * segmentStartCellGeom.width : segmentStartCellGeom.left;
              right = isTrueEventEnd && !event._isAllDay && rEndFrac !== 1.0 ? segmentEndCellGeom.left + rEndFrac * segmentEndCellGeom.width : segmentEndCellGeom.right;
            }

            let width = Math.max(0, right - left);
            if (width > 1) width -= 1;
            width = Math.max(0.5, width);

            const top = calculateEventSegmentBaseTop(segmentStartCellGeom, placementLvl, viewConfig);

            segmentDiv.style.left = `${left}px`;
            segmentDiv.style.top = `${top - 1}px`; // Changed from `${top}px`
            segmentDiv.style.width = `${width}px`;
            segmentDiv.style.height = `${viewConfig.overlayHeight}px`;

            if (viewConfig.viewName !== "year" && width > 15) {
              const nameSpan = document.createElement("span");
              nameSpan.className = "event-overlay-name";
              nameSpan.textContent = event.name;
              segmentDiv.appendChild(nameSpan);
            }
            segmentDiv.dataset.eventId = event.id;
            segmentDiv.dataset.level = placementLvl;
            segmentDiv.setAttribute("draggable", "true");
            overlaysFrag.appendChild(segmentDiv);
          } else {
            releaseElementToPool(segmentDiv, "eventOverlay");
          }

          for (let d = dayIter; d <= currentSegmentEndDt; d = d.plus({ days: 1 })) {
            const dStr = d.toFormat("yyyy-MM-dd");
            ensureDayStructure(dStr);
            let occStartFrac = event._isAllDay ? 0.0 : d.hasSame(startDisp, "day") ? event._startFraction ?? DateUtils.timeToFraction(startDisp.toFormat("HH:mm")) ?? 0.0 : 0.0;
            let occEndFrac = event._isAllDay
              ? 1.0
              : d.hasSame(actualVisualLastDayDt, "day")
              ? event._endFraction ??
                (() => {
                  const et = endDisp.toFormat("HH:mm");
                  return et === "00:00" && !startDisp.hasSame(endDisp, "day") ? 1.0 : DateUtils.timeToFraction(et) ?? 1.0;
                })()
              : 1.0;
            if (!event._isAllDay && d.hasSame(startDisp, "day") && d.hasSame(endDisp.startOf("day"), "day") && occEndFrac <= occStartFrac) {
              if (startDisp.equals(endDisp)) continue;
              occEndFrac = Math.min(1.0, occStartFrac + 5 / (24 * 60));
            }
            if (occEndFrac > occStartFrac) {
              levelsOccupiedPerDay.get(dStr)[placementLvl].push({ startFraction: occStartFrac, endFraction: occEndFrac, eventId: event.id, isAllDay: event._isAllDay });
            }
            drawnEventDaySegments.add(`${event.id}-${dStr}`);
          }
          dayIter = currentSegmentEndDt.plus({ days: 1 });
        } else {
          if (dayIter >= startDisp.startOf("day") && dayIter <= actualVisualLastDayDt) {
            hiddenEventsPerDay.set(dayStr, (hiddenEventsPerDay.get(dayStr) || 0) + 1);
            drawnEventDaySegments.add(eventDayKey);
          }
          dayIter = dayIter.plus({ days: 1 });
        }
      }
    });
    monthCard.appendChild(overlaysFrag);

    hiddenEventsPerDay.forEach((count, dateStr) => {
      const dayEl = dayEls.find((el) => el.dataset.date === dateStr);
      if (dayEl && dayEl.dataset.position && count > 0) {
        const geom = cellCache.get(dayEl.dataset.position);
        if (geom) {
          const box = getElementFromPool("countBox");
          box.className = "event-count-box";
          box.textContent = `+${count}`;
          box.onclick = (e) => {
            e.stopPropagation();
            openModal("list", dateStr);
          };
          const size = viewConfig.countBoxHeight,
            xOff = viewConfig.viewName === "year" ? 1 : 2,
            yOff = viewConfig.viewName === "year" ? 1 : 2;
          box.style.cssText = `position:absolute;top:${geom.top + geom.height - size - yOff}px;left:${geom.left + geom.width - size - xOff}px;width:${size}px;height:${size}px;line-height:${size}px;z-index:15;`;
          countsFrag.appendChild(box);
        }
      }
    });
    monthCard.appendChild(countsFrag);
    hiddenEventsPerDay.clear();
  });
}

function renderWeekViewEvents(eventsToRender, viewConfig, dayColumnElements, allDaySlotGeometriesMap) {
  const HOUR_HEIGHT_PX = viewConfig.hourHeightPx;
  const ALL_DAY_EVENT_HEIGHT_PX = 18;
  const ALL_DAY_VERTICAL_SPACING_PX = 2;
  const MAX_ALL_DAY_LEVELS = 3;

  const weekContentContainer = document.querySelector(".calendar-container.week-view .week-grid-content, .calendar-container.day-view .week-grid-content");
  if (!weekContentContainer) return;

  const dayColumns = dayColumnElements;
  if (!dayColumns || dayColumns.length === 0) return;
  const numDaysInView = dayColumns.length;

  const allDayRow = weekContentContainer.querySelector(".week-all-day-row");
  if (!allDayRow) return;

  // Use the passed geometries, or rebuild if not available (e.g. fallback in renderEventVisuals)
  const currentAllDaySlotGeometries = allDaySlotGeometriesMap || new Map();
  if (!allDaySlotGeometriesMap) {
    // If map wasn't passed, try to populate it as a fallback
    const slotDOMElements = Array.from(allDayRow.querySelectorAll(".week-all-day-slot[data-date]"));
    slotDOMElements.forEach((slot) => {
      currentAllDaySlotGeometries.set(slot.dataset.date, {
        width: slot.offsetWidth,
        left: slot.offsetLeft,
      });
    });
  }

  const viewStartDt = luxon.DateTime.fromISO(dayColumns[0].dataset.date, { zone: viewConfig.displayZone }).startOf("day");
  const viewEndDt = luxon.DateTime.fromISO(dayColumns[numDaysInView - 1].dataset.date, { zone: viewConfig.displayZone }).endOf("day");

  const eventsInView = eventsToRender.filter((event) => {
    if (!event._startDt || !event._startDt.isValid || !event._endDt || !event._endDt.isValid) return false;
    const eventStartDisp = event._startDt.setZone(viewConfig.displayZone);
    const eventEndDisp = luxon.DateTime.max(eventStartDisp, event._endDt.setZone(viewConfig.displayZone));
    if (!eventStartDisp.isValid || !eventEndDisp.isValid) return false;
    const eventInterval = luxon.Interval.fromDateTimes(eventStartDisp, eventEndDisp);
    const currentViewInterval = luxon.Interval.fromDateTimes(viewStartDt, viewEndDt);
    return eventInterval.overlaps(currentViewInterval);
  });

  const allDayEvents = eventsInView.filter((e) => e._isAllDay);
  const allDayLevels = Array.from({ length: MAX_ALL_DAY_LEVELS }, () => new Array(numDaysInView).fill(null));
  const hiddenAllDayCounts = new Array(numDaysInView).fill(0);
  const allDayFrag = document.createDocumentFragment();

  allDayEvents.forEach((event) => {
    if (!event._startDt.isValid || !event._endDt.isValid) return;
    const eventStartDay = event._startDt.setZone(viewConfig.displayZone).startOf("day");
    const eventEndDay = event._endDt.setZone(viewConfig.displayZone).startOf("day");
    if (!eventStartDay.isValid || !eventEndDay.isValid) return;

    let placed = false;
    for (let level = 0; level < MAX_ALL_DAY_LEVELS; level++) {
      let canPlace = true;
      for (let dayIdx = 0; dayIdx < numDaysInView; dayIdx++) {
        const currentDayInGrid = viewStartDt.plus({ days: dayIdx });
        if (currentDayInGrid >= eventStartDay && currentDayInGrid <= eventEndDay) {
          if (allDayLevels[level][dayIdx] !== null) {
            canPlace = false;
            break;
          }
        }
      }

      if (canPlace) {
        let segmentStartIndex = -1;
        for (let dayIdx = 0; dayIdx < numDaysInView; dayIdx++) {
          const currentDayInGrid = viewStartDt.plus({ days: dayIdx });
          if (currentDayInGrid >= eventStartDay && currentDayInGrid <= eventEndDay) {
            allDayLevels[level][dayIdx] = event.id;
            if (segmentStartIndex === -1) segmentStartIndex = dayIdx;

            if (dayIdx === numDaysInView - 1 || currentDayInGrid.equals(eventEndDay) || !(viewStartDt.plus({ days: dayIdx + 1 }) >= eventStartDay && viewStartDt.plus({ days: dayIdx + 1 }) <= eventEndDay)) {
              const firstSlotDateStr = viewStartDt.plus({ days: segmentStartIndex }).toFormat("yyyy-MM-dd");
              const firstSlotGeom = currentAllDaySlotGeometries.get(firstSlotDateStr);

              if (firstSlotGeom) {
                const segmentDiv = getElementFromPool("weekAllDaySegment");
                segmentDiv.className = "week-all-day-event-segment";
                segmentDiv.textContent = event.name;
                segmentDiv.title = event.name;
                segmentDiv.style.backgroundColor = event.color || "#3b82f6";
                segmentDiv.style.top = `${level * (ALL_DAY_EVENT_HEIGHT_PX + ALL_DAY_VERTICAL_SPACING_PX)}px`;
                segmentDiv.style.height = `${ALL_DAY_EVENT_HEIGHT_PX}px`;
                segmentDiv.style.left = `${firstSlotGeom.left}px`;
                segmentDiv.dataset.level = level;

                let totalWidth = 0;
                for (let k = segmentStartIndex; k <= dayIdx; k++) {
                  const slotDate = viewStartDt.plus({ days: k }).toFormat("yyyy-MM-dd");
                  const geom = currentAllDaySlotGeometries.get(slotDate);
                  if (geom && geom.width) totalWidth += geom.width; // Check geom.width
                }
                const numDaysInSegmentVisual = dayIdx - segmentStartIndex + 1;
                segmentDiv.style.width = `${totalWidth > 0 ? totalWidth - (numDaysInSegmentVisual > 1 ? 2 : 0) : 0}px`;
                if (totalWidth <= 0) segmentDiv.style.display = "none"; // Hide if no width

                segmentDiv.dataset.eventId = event.id;
                segmentDiv.setAttribute("draggable", "true");
                segmentDiv.onclick = (e) => {
                  e.stopPropagation();
                  openModal("form", event.id);
                };
                allDayFrag.appendChild(segmentDiv);
              }
              segmentStartIndex = -1;
            }
          }
        }
        placed = true;
        break;
      }
    }
    if (!placed) {
      for (let dayIdx = 0; dayIdx < numDaysInView; dayIdx++) {
        const currentDayInGrid = viewStartDt.plus({ days: dayIdx });
        if (currentDayInGrid >= eventStartDay && currentDayInGrid <= eventEndDay) {
          hiddenAllDayCounts[dayIdx]++;
        }
      }
    }
  });
  allDayRow.appendChild(allDayFrag);

  const allDaySlotElementsForMoreBox = Array.from(allDayRow.querySelectorAll(".week-all-day-slot[data-date]"));
  hiddenAllDayCounts.forEach((count, dayIdx) => {
    if (count > 0) {
      const targetSlotElement = allDaySlotElementsForMoreBox[dayIdx];
      if (targetSlotElement) {
        const moreBox = getElementFromPool("countBox");
        moreBox.className = "event-count-box all-day-more";
        moreBox.textContent = `+${count}`;
        moreBox.style.top = `${MAX_ALL_DAY_LEVELS * (ALL_DAY_EVENT_HEIGHT_PX + ALL_DAY_VERTICAL_SPACING_PX)}px`;
        moreBox.style.right = `2px`;
        moreBox.onclick = (e) => {
          e.stopPropagation();
          openModal("list", viewStartDt.plus({ days: dayIdx }).toFormat("yyyy-MM-dd"));
        };
        targetSlotElement.appendChild(moreBox);
      }
    }
  });

  const timedEvents = eventsInView.filter((e) => !e._isAllDay);
  dayColumns.forEach((dayColumn, dayIndexInView) => {
    const timedEventsFragment = document.createDocumentFragment();
    const currentDayDt = viewStartDt.plus({ days: dayIndexInView });

    const dailySegments = [];
    timedEvents.forEach((event) => {
      if (!event._startDt.isValid || !event._endDt.isValid) return;
      const startDisp = event._startDt.setZone(viewConfig.displayZone);
      const endDisp = event._endDt.setZone(viewConfig.displayZone);
      if (!startDisp.isValid || !endDisp.isValid) return;
      const segmentStartOnDay = luxon.DateTime.max(startDisp, currentDayDt.startOf("day"));
      const segmentEndOnDay = luxon.DateTime.min(endDisp, currentDayDt.endOf("day"));
      if (segmentStartOnDay < segmentEndOnDay) {
        dailySegments.push({
          id: event.id,
          name: event.name,
          color: event.color,
          start: segmentStartOnDay,
          end: segmentEndOnDay,
          originalEvent: event,
        });
      }
    });

    if (dailySegments.length === 0) return;

    const eventPoints = [];
    dailySegments.forEach((seg) => {
      eventPoints.push({ time: seg.start, type: "start", segment: seg });
      eventPoints.push({ time: seg.end, type: "end", segment: seg });
    });
    eventPoints.sort((a, b) => {
      if (a.time < b.time) return -1;
      if (a.time > b.time) return 1;
      return a.type === "end" ? -1 : 1;
    });

    const activeSegments = [];
    const columnAssignments = new Map();
    const columnEndTimes = [];
    for (const point of eventPoints) {
      if (point.type === "start") {
        let assignedColumn = -1;
        for (let i = 0; i < columnEndTimes.length; i++) {
          if (!columnEndTimes[i] || columnEndTimes[i] <= point.segment.start) {
            assignedColumn = i;
            break;
          }
        }
        if (assignedColumn === -1) {
          assignedColumn = columnEndTimes.length;
          columnEndTimes.push(null);
        }
        columnEndTimes[assignedColumn] = point.segment.end;
        activeSegments.push({ ...point.segment, columnIndex: assignedColumn });
        columnAssignments.set(point.segment.id, { columnIndex: assignedColumn, numParallelProxy: 0 });
      } else {
        const index = activeSegments.findIndex((s) => s.id === point.segment.id && s.columnIndex !== undefined);
        if (index > -1) activeSegments.splice(index, 1);
      }
      activeSegments.forEach((actSeg) => {
        let currentOverlapCount = 0;
        for (const otherActSeg of activeSegments) {
          if (actSeg.start < otherActSeg.end && actSeg.end > otherActSeg.start) currentOverlapCount++;
        }
        const layout = columnAssignments.get(actSeg.id);
        if (layout) layout.numParallelProxy = Math.max(layout.numParallelProxy, currentOverlapCount);
      });
    }
    let overallMaxParallel = 1;
    columnAssignments.forEach((val) => (overallMaxParallel = Math.max(overallMaxParallel, val.numParallelProxy)));
    columnAssignments.forEach((val) => (val.numParallel = overallMaxParallel > 0 ? overallMaxParallel : 1));

    dailySegments.forEach((segment) => {
      const layout = columnAssignments.get(segment.id);
      if (!layout) return;
      const top = (segment.start.hour + segment.start.minute / 60) * HOUR_HEIGHT_PX; // This is the third 'const top', unrelated to the refactoring.
      const bottom = (segment.end.hour + segment.end.minute / 60) * HOUR_HEIGHT_PX;
      const height = Math.max(0, bottom - top);
      if (height <= 0) return;

      const eventBlock = getElementFromPool("weekTimedBlock");
      eventBlock.className = "week-event-block";
      eventBlock.style.backgroundColor = segment.color || "#3b82f6";
      eventBlock.style.top = `${top}px`;
      eventBlock.style.height = `${Math.max(height - 2, 15)}px`;
      const colWidthPercent = 100 / layout.numParallel;
      eventBlock.style.width = `calc(${colWidthPercent}% - 4px)`;
      eventBlock.style.left = `calc(${layout.columnIndex * colWidthPercent}% + 2px)`;
      eventBlock.dataset.eventId = segment.id;

      const nameSpan = document.createElement("span");
      nameSpan.className = "week-event-name";
      nameSpan.textContent = segment.name;
      eventBlock.appendChild(nameSpan);
      if (height > 25) {
        const timeSpan = document.createElement("span");
        timeSpan.className = "week-event-time";
        const originalStartDisp = segment.originalEvent._startDt.setZone(viewConfig.displayZone);
        const originalEndDisp = segment.originalEvent._endDt.setZone(viewConfig.displayZone);
        timeSpan.textContent = `${originalStartDisp.toFormat("HH:mm")} - ${originalEndDisp.toFormat("HH:mm")}`;
        eventBlock.appendChild(timeSpan);
      }
      eventBlock.setAttribute("draggable", "true");
      eventBlock.onclick = (e) => {
        e.stopPropagation();
        openModal("form", segment.id);
      };
      timedEventsFragment.appendChild(eventBlock);
    });
    dayColumn.appendChild(timedEventsFragment);
  });
}

function renderEventVisuals(dayColumnElements, allDaySlotGeometriesMap = null) {
  clearEventOverlaysAndCountBoxes();
  const appDisplayTimezone = luxon.DateTime.local().zoneName;
  const localCustomEvents = Array.isArray(customEvents) ? customEvents : [];

  const processedEvents = localCustomEvents
    .map((event) => {
      if (!event || !event.start || !event.end) return null;
      try {
        let startDtInternal, endDtInternal;
        const isAllDay = !event.start_utc;
        if (isAllDay) {
          startDtInternal = luxon.DateTime.fromISO(event.start, { zone: appDisplayTimezone }).startOf("day");
          endDtInternal = luxon.DateTime.fromISO(event.end, { zone: appDisplayTimezone }).endOf("day");
        } else {
          startDtInternal = luxon.DateTime.fromISO(event.start_utc, { zone: "utc" });
          endDtInternal = luxon.DateTime.fromISO(event.end_utc, { zone: "utc" });
        }

        if (!startDtInternal || !startDtInternal.isValid) {
          console.warn("Event has invalid start date, skipping:", event.id, event.start);
          return null;
        }
        if (!endDtInternal || !endDtInternal.isValid) {
          console.warn("Event has invalid end date, skipping:", event.id, event.end);
          return null;
        }

        if (endDtInternal < startDtInternal) endDtInternal = startDtInternal;

        let startFraction, endFraction;
        if (!isAllDay && startDtInternal.isValid && endDtInternal.isValid) {
          const startLocal = startDtInternal.setZone(appDisplayTimezone);
          const endLocal = endDtInternal.setZone(appDisplayTimezone);
          if (!startLocal.isValid || !endLocal.isValid) {
            console.warn("Event dates became invalid after zone conversion:", event.id);
            return null;
          }
          startFraction = DateUtils.timeToFraction(startLocal.toFormat("HH:mm"));

          const endLocalTimeStr = endLocal.toFormat("HH:mm");
          if (endLocalTimeStr === "00:00" && !startLocal.hasSame(endLocal, "day")) {
            endFraction = 1.0;
          } else {
            endFraction = DateUtils.timeToFraction(endLocalTimeStr);
          }
          if (endFraction !== null && startFraction !== null && endFraction <= startFraction && startLocal.hasSame(endLocal, "day")) {
            if (!startLocal.equals(endLocal)) endFraction = Math.min(1.0, startFraction + 5 / (24 * 60));
          }
        }

        return { ...event, _startDt: startDtInternal, _endDt: endDtInternal, _isAllDay: isAllDay, _startFraction: startFraction, _endFraction: endFraction };
      } catch (e) {
        console.error("Error processing event for renderVisuals:", event.id, e);
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      const timeA = a._startDt.toMillis();
      const timeB = b._startDt.toMillis();
      if (timeA !== timeB) return timeA - timeB;
      if (a._isAllDay && !b._isAllDay) return -1;
      if (!a._isAllDay && b._isAllDay) return 1;
      return b._endDt.toMillis() - b._startDt.toMillis() - (a._endDt.toMillis() - a._startDt.toMillis());
    });

  processedEvents.forEach((pEvent) => {
    const originalEvent = customEvents.find((ce) => ce.id === pEvent.id);
    if (originalEvent) {
      originalEvent._startDt = pEvent._startDt;
      originalEvent._endDt = pEvent._endDt;
      originalEvent._isAllDay = pEvent._isAllDay;
      originalEvent._startFraction = pEvent._startFraction;
      originalEvent._endFraction = pEvent._endFraction;
    }
  });

  if (processedEvents.length === 0 && currentView !== "day") {
    if (typeof addDragAndDropListeners === "function") addDragAndDropListeners();
    if (typeof window.addEventResizeListeners === "function") window.addEventResizeListeners();
    return;
  }

  const viewConfig = {
    displayZone: appDisplayTimezone,
    overlayHeight: currentView === "year" ? 5 : 18,
    verticalSpacing: currentView === "year" ? 1 : currentView === "month" ? 3 : 2,
    countBoxHeight: currentView === "year" ? 12 : 20,
    maxPlacementLevels: 3,
    hourHeightPx: 40,
  };

  if (currentView === "year" || currentView === "month") {
    viewConfig.viewName = currentView;
    renderMonthYearViewEvents(processedEvents, viewConfig);
  } else if (currentView === "week" || currentView === "day") {
    viewConfig.viewName = currentView;
    if (dayColumnElements && dayColumnElements.length > 0) {
      renderWeekViewEvents(processedEvents, viewConfig, dayColumnElements, allDaySlotGeometriesMap);
    } else {
      const queriedColumns = Array.from(calendarContainer.querySelectorAll(".week-day-column"));
      if (queriedColumns.length > 0) {
        let fallbackGeometries = new Map();
        const ar = document.querySelector(`.${currentView}-view .week-all-day-row`) || document.querySelector(".week-all-day-row");
        if (ar) {
          ar.querySelectorAll(".week-all-day-slot[data-date]").forEach((s) => fallbackGeometries.set(s.dataset.date, { width: s.offsetWidth, left: s.offsetLeft }));
        }
        renderWeekViewEvents(processedEvents, viewConfig, queriedColumns, fallbackGeometries);
      }
    }
  }

  if (typeof addDragAndDropListeners === "function") addDragAndDropListeners();
  if (typeof window.addEventResizeListeners === "function") window.addEventResizeListeners();
}
window.renderEventVisuals = renderEventVisuals;
// --- END OF FILE eventRenderer.js ---
