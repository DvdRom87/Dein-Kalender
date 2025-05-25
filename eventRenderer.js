function clearEventOverlaysAndCountBoxes() {
  document.querySelectorAll(".event-overlay, .event-count-box, .resize-preview-segment, .week-event-block, .week-all-day-event-segment").forEach((el) => el.remove());
}
window.clearEventOverlaysAndCountBoxes = clearEventOverlaysAndCountBoxes;

function createEventSegmentElement(eventData, segmentStartDt, segmentEndDt, actualVisualLastDayDt, cellGeometryCache, startOffsetInGrid, placementLevel, viewConfig, isPreview = false) {
  const isAllDayEvent = eventData._isAllDay;
  const eventStartInDisplayZone = eventData._startDt.setZone(viewConfig.displayZone);
  const eventEndInDisplayZone = eventData._endDt.setZone(viewConfig.displayZone);
  const isTrueEventStart = segmentStartDt.hasSame(eventStartInDisplayZone, "day");
  const isTrueEventEnd = segmentEndDt.hasSame(actualVisualLastDayDt, "day");
  const startCellPos = String(startOffsetInGrid + segmentStartDt.day - 1);
  const endCellPos = String(startOffsetInGrid + segmentEndDt.day - 1);
  const segmentStartCellGeom = cellGeometryCache.get(startCellPos);
  const segmentEndCellGeom = cellGeometryCache.get(endCellPos);

  if (!segmentStartCellGeom || !segmentEndCellGeom) {
    return null;
  }
  const segmentDiv = document.createElement("div");
  if (isPreview) {
    segmentDiv.className = "resize-preview-segment";
    segmentDiv.style.backgroundColor = eventData.color ? `${eventData.color}99` : `rgba(59, 130, 246, 0.6)`;
  } else {
    segmentDiv.classList.add("event-overlay");
    segmentDiv.style.backgroundColor = eventData.color || "#3b82f6";
    if (isTrueEventStart) segmentDiv.classList.add("event-overlay-start");
    if (isTrueEventEnd) segmentDiv.classList.add("event-overlay-end");
    if (typeof openModal === "function") {
      segmentDiv.addEventListener("click", (e) => {
        e.stopPropagation();
        openModal("form", eventData.id);
      });
    }
  }
  let renderStartFrac = 0.0;
  let renderEndFrac = 1.0;

  if (!isAllDayEvent) {
    if (isTrueEventStart && segmentStartDt.hasSame(eventStartInDisplayZone, "day")) {
      renderStartFrac = DateUtils.timeToFraction(eventStartInDisplayZone.toFormat("HH:mm")) ?? 0.0;
    }
    if (isTrueEventEnd && segmentEndDt.hasSame(eventEndInDisplayZone.startOf("day"), "day")) {
      // If it's the true end, calculate end fraction
      const endLocalTime = eventEndInDisplayZone.toFormat("HH:mm");
      if (endLocalTime === "00:00" && !eventStartInDisplayZone.hasSame(eventEndInDisplayZone, "day")) {
        // Event ends exactly at midnight of the next day, so it fills the current day segment
        renderEndFrac = 1.0;
      } else {
        renderEndFrac = DateUtils.timeToFraction(endLocalTime) ?? 1.0;
      }
    }
  }

  // Ensure renderEndFrac is not <= renderStartFrac for same-day timed events, give minimum visual width
  if (!isAllDayEvent && segmentStartDt.hasSame(segmentEndDt, "day") && renderEndFrac <= renderStartFrac) {
    if (renderEndFrac === 0 && renderStartFrac === 0 && eventStartInDisplayZone.equals(eventEndInDisplayZone)) {
      // Zero duration event
      return null; // Don't render zero-duration events
    }
    renderEndFrac = Math.min(1.0, renderStartFrac + 5 / (24 * 60)); // Min 5 minutes visual width
  }

  let left = segmentStartCellGeom.left + renderStartFrac * segmentStartCellGeom.width;
  let right = segmentEndCellGeom.left + renderEndFrac * segmentEndCellGeom.width;

  // Adjust for multi-day segments to span full cells unless it's the true start/end with fractional time
  if (!segmentStartDt.hasSame(segmentEndDt, "day")) {
    // Multi-day segment
    left = isTrueEventStart && !isAllDayEvent ? segmentStartCellGeom.left + renderStartFrac * segmentStartCellGeom.width : segmentStartCellGeom.left;
    right = isTrueEventEnd && !isAllDayEvent && renderEndFrac !== 1.0 ? segmentEndCellGeom.left + renderEndFrac * segmentEndCellGeom.width : segmentEndCellGeom.right;
  }

  let width = Math.max(0, right - left);
  if (width > 1 && !isPreview) width -= 1; // Small gap between non-preview segments
  width = Math.max(isPreview ? 3 : 0.5, width); // Minimum width

  const top = segmentStartCellGeom.top + segmentStartCellGeom.height - placementLevel * (viewConfig.overlayHeight + viewConfig.verticalSpacing) - viewConfig.overlayHeight - (viewConfig.viewName === "year" ? 1 : 2); // Small bottom margin

  segmentDiv.style.left = `${left}px`;
  segmentDiv.style.top = `${top}px`;
  segmentDiv.style.width = `${width}px`;
  segmentDiv.style.height = `${viewConfig.overlayHeight}px`; // Set height from viewConfig

  if (!isPreview && viewConfig.viewName !== "year" && width > 15) {
    // Show name in month view if wide enough
    const nameSpan = document.createElement("span");
    nameSpan.classList.add("event-overlay-name");
    nameSpan.textContent = eventData.name;
    segmentDiv.appendChild(nameSpan);
  }
  segmentDiv.dataset.eventId = eventData.id;
  segmentDiv.dataset.level = placementLevel;
  return segmentDiv;
}
window.createEventSegmentElement = createEventSegmentElement;

function renderMonthYearViewEvents(eventsToRender, viewConfig) {
  const levelsOccupiedPerDay = new Map(); // dateStr -> [level0_occupancy, level1_occupancy, ...]
  // occupancy is array of {startFraction, endFraction, eventId}
  const hiddenEventsPerDay = new Map(); // dateStr -> count
  const drawnEventDaySegments = new Set(); // "eventId-dateStr" to avoid re-processing parts of same event

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
    if (!cellCache || cellCache.size === 0) {
      // console.warn(`No cell cache for month card ${monthCard.id}, skipping event rendering for it.`);
      return;
    }

    const overlaysFrag = document.createDocumentFragment();
    const countsFrag = document.createDocumentFragment();

    const firstGridDt = luxon.DateTime.fromISO(dayEls[0].dataset.date, { zone: viewConfig.displayZone }).startOf("day");
    const lastGridDt = luxon.DateTime.fromISO(dayEls[dayEls.length - 1].dataset.date, { zone: viewConfig.displayZone }).endOf("day");

    let gridOffset = luxon.DateTime.local(firstGridDt.year, firstGridDt.month, 1, { zone: viewConfig.displayZone }).weekday - 1;
    if (gridOffset < 0) gridOffset = 6; // 0 (Mon) to 6 (Sun)

    const cardEvents = eventsToRender.filter((event) => {
      const eventStartDisp = event._startDt.setZone(viewConfig.displayZone);
      // Ensure eventEndDisp is at least eventStartDisp for interval creation
      const eventEndDisp = luxon.DateTime.max(eventStartDisp, event._endDt.setZone(viewConfig.displayZone));
      const eventInterval = luxon.Interval.fromDateTimes(eventStartDisp, eventEndDisp);
      const cardInterval = luxon.Interval.fromDateTimes(firstGridDt, lastGridDt);
      return eventInterval.overlaps(cardInterval);
    });

    cardEvents.forEach((event) => {
      const startDisp = event._startDt.setZone(viewConfig.displayZone);
      const endDisp = event._endDt.setZone(viewConfig.displayZone);

      // Determine the actual visual last day for the event
      let actualVisualLastDayDt = endDisp;
      if (event._isAllDay) {
        actualVisualLastDayDt = endDisp.startOf("day"); // Inclusive end for all-day
      } else {
        // For timed events, if end time is 00:00 of next day, it visually ends on previous day
        if (endDisp.hour === 0 && endDisp.minute === 0 && endDisp.second === 0 && !startDisp.hasSame(endDisp, "day")) {
          actualVisualLastDayDt = endDisp.minus({ days: 1 }).startOf("day");
        } else {
          actualVisualLastDayDt = endDisp.startOf("day");
        }
      }
      // Ensure visual end is not before visual start
      if (actualVisualLastDayDt < startDisp.startOf("day")) {
        actualVisualLastDayDt = startDisp.startOf("day");
      }

      let dayIter = luxon.DateTime.max(startDisp.startOf("day"), firstGridDt);
      while (dayIter <= actualVisualLastDayDt && dayIter <= lastGridDt) {
        const dayStr = dayIter.toFormat("yyyy-MM-dd");
        const eventDayKey = `${event.id}-${dayStr}`;

        if (drawnEventDaySegments.has(eventDayKey)) {
          dayIter = dayIter.plus({ days: 1 });
          continue;
        }

        let placementLvl = -1;
        let currentSegmentEndDt = dayIter; // The end of the segment we are trying to place

        // Determine fractional occupation for the current dayIter
        let currentDayStartFraction = 0.0;
        let currentDayEndFraction = 1.0;
        if (!event._isAllDay) {
          if (dayIter.hasSame(startDisp, "day")) {
            currentDayStartFraction = DateUtils.timeToFraction(startDisp.toFormat("HH:mm")) ?? 0.0;
          }
          if (dayIter.hasSame(endDisp.startOf("day"), "day")) {
            const endLocalTime = endDisp.toFormat("HH:mm");
            if (endLocalTime === "00:00" && !startDisp.hasSame(endDisp, "day")) {
              currentDayEndFraction = 1.0;
            } else {
              currentDayEndFraction = DateUtils.timeToFraction(endLocalTime) ?? 1.0;
            }
          }
          if (currentDayEndFraction <= currentDayStartFraction && dayIter.hasSame(startDisp, "day") && dayIter.hasSame(endDisp.startOf("day"), "day")) {
            if (startDisp.equals(endDisp)) {
              // Zero duration
              dayIter = dayIter.plus({ days: 1 });
              continue;
            }
            currentDayEndFraction = Math.min(1.0, currentDayStartFraction + 5 / (24 * 60)); // Min 5 min visual width
          }
        }

        for (let lvlIdx = 0; lvlIdx < viewConfig.maxPlacementLevels; lvlIdx++) {
          ensureDayStructure(dayStr);
          const occupiedSlotsOnLevel = levelsOccupiedPerDay.get(dayStr)[lvlIdx];
          const conflictsOnLevel = occupiedSlotsOnLevel.some((slot) => Math.max(currentDayStartFraction, slot.startFraction) < Math.min(currentDayEndFraction, slot.endFraction) && currentDayEndFraction > currentDayStartFraction);

          if (!conflictsOnLevel) {
            placementLvl = lvlIdx;
            // Try to extend this segment to subsequent days in the same week
            let nextDayInSegment = dayIter.plus({ days: 1 });
            const endOfWeekForIter = dayIter.endOf("week"); // Monday-Sunday week
            const maxPossibleExtensionEnd = luxon.DateTime.min(actualVisualLastDayDt, endOfWeekForIter, lastGridDt);

            while (nextDayInSegment <= maxPossibleExtensionEnd) {
              const nextDayStr = nextDayInSegment.toFormat("yyyy-MM-dd");
              if (drawnEventDaySegments.has(`${event.id}-${nextDayStr}`)) break; // Part of event already drawn

              ensureDayStructure(nextDayStr);
              let nextDayStartFrac = 0.0,
                nextDayEndFrac = 1.0;
              if (!event._isAllDay) {
                if (nextDayInSegment.hasSame(startDisp, "day")) nextDayStartFrac = DateUtils.timeToFraction(startDisp.toFormat("HH:mm")) ?? 0.0;
                if (nextDayInSegment.hasSame(endDisp.startOf("day"), "day")) {
                  const endLocalT = endDisp.toFormat("HH:mm");
                  if (endLocalT === "00:00" && !startDisp.hasSame(endDisp, "day")) nextDayEndFrac = 1.0;
                  else nextDayEndFrac = DateUtils.timeToFraction(endLocalT) ?? 1.0;
                }
                if (nextDayEndFrac <= nextDayStartFrac && nextDayInSegment.hasSame(startDisp, "day") && nextDayInSegment.hasSame(endDisp.startOf("day"), "day")) {
                  if (startDisp.equals(endDisp)) break; // cannot extend zero duration
                  nextDayEndFrac = Math.min(1.0, nextDayStartFrac + 5 / (24 * 60));
                }
              }

              const nextDayOccupied = levelsOccupiedPerDay.get(nextDayStr)[placementLvl];
              const conflictsOnNextDay = nextDayOccupied.some((slot) => Math.max(nextDayStartFrac, slot.startFraction) < Math.min(nextDayEndFrac, slot.endFraction) && nextDayEndFrac > nextDayStartFrac);
              if (conflictsOnNextDay) break; // Cannot extend to this day on this level

              currentSegmentEndDt = nextDayInSegment;
              nextDayInSegment = nextDayInSegment.plus({ days: 1 });
            }
            break; // Found a level and extended segment
          }
        }

        if (placementLvl !== -1) {
          const segmentDiv = createEventSegmentElement(event, dayIter, currentSegmentEndDt, actualVisualLastDayDt, cellCache, gridOffset, placementLvl, viewConfig, false);
          if (segmentDiv) {
            segmentDiv.setAttribute("draggable", "true");
            overlaysFrag.appendChild(segmentDiv);

            // Mark days and fractions as occupied for this segment
            for (let d = dayIter; d <= currentSegmentEndDt; d = d.plus({ days: 1 })) {
              const dStr = d.toFormat("yyyy-MM-dd");
              ensureDayStructure(dStr);
              let occStartFrac = 0.0,
                occEndFrac = 1.0;
              if (!event._isAllDay) {
                if (d.hasSame(startDisp, "day")) occStartFrac = DateUtils.timeToFraction(startDisp.toFormat("HH:mm")) ?? 0.0;
                if (d.hasSame(endDisp.startOf("day"), "day")) {
                  const endLocalT = endDisp.toFormat("HH:mm");
                  if (endLocalT === "00:00" && !startDisp.hasSame(endDisp, "day")) occEndFrac = 1.0;
                  else occEndFrac = DateUtils.timeToFraction(endLocalT) ?? 1.0;
                }
                if (occEndFrac <= occStartFrac && d.hasSame(startDisp, "day") && d.hasSame(endDisp.startOf("day"), "day")) {
                  if (startDisp.equals(endDisp)) continue; // skip zero duration
                  occEndFrac = Math.min(1.0, occStartFrac + 5 / (24 * 60));
                }
              }
              if (occEndFrac > occStartFrac) {
                // Only add if it has positive duration on this day
                levelsOccupiedPerDay.get(dStr)[placementLvl].push({ startFraction: occStartFrac, endFraction: occEndFrac, eventId: event.id });
              }
              drawnEventDaySegments.add(`${event.id}-${dStr}`);
            }
          }
          dayIter = currentSegmentEndDt.plus({ days: 1 }); // Move to day after segment
        } else {
          // Event could not be placed in visible levels for dayStr
          if (dayIter >= startDisp.startOf("day") && dayIter <= actualVisualLastDayDt) {
            hiddenEventsPerDay.set(dayStr, (hiddenEventsPerDay.get(dayStr) || 0) + 1);
            drawnEventDaySegments.add(eventDayKey); // Mark as processed (even if hidden) to avoid double counting for "+N"
          }
          dayIter = dayIter.plus({ days: 1 });
        }
      }
    });
    monthCard.appendChild(overlaysFrag); // Append all overlays for this card

    // Add "+N more" boxes
    hiddenEventsPerDay.forEach((count, dateStr) => {
      const dayEl = dayEls.find((el) => el.dataset.date === dateStr);
      if (dayEl && dayEl.dataset.position && count > 0) {
        const geom = cellCache.get(dayEl.dataset.position);
        if (geom) {
          const box = document.createElement("div");
          box.className = "event-count-box";
          box.textContent = `+${count}`;
          if (typeof openModal === "function")
            box.addEventListener("click", (e) => {
              e.stopPropagation();
              openModal("list", dateStr);
            });
          const size = viewConfig.countBoxHeight,
            xOff = viewConfig.viewName === "year" ? 1 : 2,
            yOff = viewConfig.viewName === "year" ? 1 : 2;
          box.style.cssText = `position:absolute;top:${geom.top + geom.height - size - yOff}px;left:${geom.left + geom.width - size - xOff}px;width:${size}px;height:${size}px;line-height:${size}px;z-index:15;`;
          countsFrag.appendChild(box);
        }
      }
    });
    monthCard.appendChild(countsFrag);
    hiddenEventsPerDay.clear(); // Clear for the next card
  });
}

function renderWeekViewEvents(eventsToRender, viewConfig, dayColumnElements) {
  const HOUR_HEIGHT_PX = viewConfig.hourHeightPx;
  const ALL_DAY_EVENT_HEIGHT_PX = 18;
  const ALL_DAY_VERTICAL_SPACING_PX = 2;
  const MAX_ALL_DAY_LEVELS = 3;

  const weekContentContainer = document.querySelector(".calendar-container.week-view .week-grid-content, .calendar-container.day-view .week-grid-content");
  if (!weekContentContainer) return;

  const dayColumns = dayColumnElements;
  if (!dayColumns || dayColumns.length === 0) {
    console.error("Week/Day view day columns not properly initialized or passed.");
    return;
  }
  const numDaysInView = dayColumns.length; // Will be 1 for Day view, 7 for Week view

  const allDaySlotsContainer = weekContentContainer.querySelector(".week-all-day-row");

  const viewStartDt = luxon.DateTime.fromISO(dayColumns[0].dataset.date, { zone: viewConfig.displayZone }).startOf("day");
  const viewEndDt = luxon.DateTime.fromISO(dayColumns[numDaysInView - 1].dataset.date, { zone: viewConfig.displayZone }).endOf("day");

  const eventsInView = eventsToRender.filter((event) => {
    const eventStartDisp = event._startDt.setZone(viewConfig.displayZone);
    const eventEndDisp = luxon.DateTime.max(eventStartDisp, event._endDt.setZone(viewConfig.displayZone)); // Ensure end is not before start
    const eventInterval = luxon.Interval.fromDateTimes(eventStartDisp, eventEndDisp);
    const currentViewInterval = luxon.Interval.fromDateTimes(viewStartDt, viewEndDt);
    return eventInterval.overlaps(currentViewInterval);
  });

  // --- All-Day Events Rendering ---
  const allDayEvents = eventsInView.filter((e) => e._isAllDay);
  const allDayLevels = []; // Each element is an array for a day, storing event IDs at that level
  for (let i = 0; i < MAX_ALL_DAY_LEVELS; i++) allDayLevels.push(new Array(numDaysInView).fill(null));
  const hiddenAllDayCounts = new Array(numDaysInView).fill(0);

  allDayEvents.forEach((event) => {
    const eventStartDay = event._startDt.setZone(viewConfig.displayZone).startOf("day");
    const eventEndDay = event._endDt.setZone(viewConfig.displayZone).startOf("day"); // Inclusive end for all-day model
    let placed = false;
    for (let level = 0; level < MAX_ALL_DAY_LEVELS; level++) {
      let canPlace = true;
      for (let dayIdx = 0; dayIdx < numDaysInView; dayIdx++) {
        const currentDayInGrid = viewStartDt.plus({ days: dayIdx });
        if (currentDayInGrid >= eventStartDay && currentDayInGrid <= eventEndDay) {
          // Check if event spans this day
          if (allDayLevels[level][dayIdx] !== null) {
            // Check if level is occupied on this day
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
            allDayLevels[level][dayIdx] = event.id; // Mark level as occupied by this event
            if (segmentStartIndex === -1) segmentStartIndex = dayIdx;

            if (dayIdx === numDaysInView - 1 || currentDayInGrid.equals(eventEndDay) || !(viewStartDt.plus({ days: dayIdx + 1 }) >= eventStartDay && viewStartDt.plus({ days: dayIdx + 1 }) <= eventEndDay)) {
              const targetAllDaySlot = allDaySlotsContainer.children[segmentStartIndex + 1];
              if (!targetAllDaySlot) continue;

              const segmentDiv = document.createElement("div");
              segmentDiv.className = "week-all-day-event-segment";
              segmentDiv.textContent = event.name;
              segmentDiv.title = event.name;
              segmentDiv.style.backgroundColor = event.color || "#3b82f6";
              segmentDiv.style.top = `${level * (ALL_DAY_EVENT_HEIGHT_PX + ALL_DAY_VERTICAL_SPACING_PX)}px`;
              segmentDiv.style.height = `${ALL_DAY_EVENT_HEIGHT_PX}px`;
              segmentDiv.dataset.level = level;

              const numDaysInSegment = dayIdx - segmentStartIndex + 1;
              const slotWidth = targetAllDaySlot.offsetWidth;

              if (numDaysInView === 1) {
                segmentDiv.style.width = `calc(100% - 4px)`;
              } else if (numDaysInSegment > 1) {
                segmentDiv.style.width = `calc(${numDaysInSegment * slotWidth}px - 4px)`;
              } else {
                // numDaysInSegment === 1 (for week view)
                segmentDiv.style.width = `calc(100% - 4px)`;
              }
              segmentDiv.style.left = "2px";

              segmentDiv.dataset.eventId = event.id;
              segmentDiv.setAttribute("draggable", "true");
              if (typeof openModal === "function") {
                segmentDiv.addEventListener("click", (e) => {
                  e.stopPropagation();
                  openModal("form", event.id);
                });
              }
              targetAllDaySlot.appendChild(segmentDiv);
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

  hiddenAllDayCounts.forEach((count, dayIdx) => {
    if (count > 0) {
      const targetAllDaySlot = allDaySlotsContainer.children[dayIdx + 1];
      if (!targetAllDaySlot) return;
      const moreBox = document.createElement("div");
      moreBox.className = "event-count-box all-day-more";
      moreBox.textContent = `+${count}`;
      moreBox.style.top = `${MAX_ALL_DAY_LEVELS * (ALL_DAY_EVENT_HEIGHT_PX + ALL_DAY_VERTICAL_SPACING_PX)}px`;
      moreBox.style.right = `2px`;
      if (typeof openModal === "function") {
        moreBox.addEventListener("click", (e) => {
          e.stopPropagation();
          openModal("list", viewStartDt.plus({ days: dayIdx }).toFormat("yyyy-MM-dd"));
        });
      }
      targetAllDaySlot.appendChild(moreBox);
    }
  });

  // --- Timed Events Rendering (Improved Collision/Layout) ---
  const timedEvents = eventsInView.filter((e) => !e._isAllDay);
  dayColumns.forEach((dayColumn, dayIndexInView) => {
    const currentDayDt = viewStartDt.plus({ days: dayIndexInView });
    const dayStr = currentDayDt.toFormat("yyyy-MM-dd");

    const dailySegments = [];
    timedEvents.forEach((event) => {
      const startDisp = event._startDt.setZone(viewConfig.displayZone);
      const endDisp = event._endDt.setZone(viewConfig.displayZone);

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
    let maxColumnsUsedThisDay = 0;
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
        if (index > -1) {
          activeSegments.splice(index, 1);
        }
      }
      activeSegments.forEach((actSeg) => {
        let currentOverlapCount = 0;
        for (const otherActSeg of activeSegments) {
          if (actSeg.start < otherActSeg.end && actSeg.end > otherActSeg.start) {
            currentOverlapCount++;
          }
        }
        const layout = columnAssignments.get(actSeg.id);
        if (layout) layout.numParallelProxy = Math.max(layout.numParallelProxy, currentOverlapCount);
      });
    }

    let overallMaxParallel = 1;
    columnAssignments.forEach((val) => {
      overallMaxParallel = Math.max(overallMaxParallel, val.numParallelProxy);
    });
    columnAssignments.forEach((val) => {
      val.numParallel = overallMaxParallel > 0 ? overallMaxParallel : 1;
    });

    dailySegments.forEach((segment) => {
      const layout = columnAssignments.get(segment.id);
      if (!layout) {
        return;
      }

      const top = (segment.start.hour + segment.start.minute / 60) * HOUR_HEIGHT_PX;
      const bottom = (segment.end.hour + segment.end.minute / 60) * HOUR_HEIGHT_PX;
      const height = Math.max(0, bottom - top);

      if (height <= 0) return;

      const eventBlock = document.createElement("div");
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
      if (typeof openModal === "function") {
        eventBlock.addEventListener("click", (e) => {
          e.stopPropagation();
          openModal("form", segment.id);
        });
      }
      dayColumn.appendChild(eventBlock);
    });
  });
}

function renderEventVisuals(...args) {
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
          endDtInternal = luxon.DateTime.fromISO(event.end, { zone: appDisplayTimezone }).endOf("day"); // Inclusive end for all-day
        } else {
          startDtInternal = luxon.DateTime.fromISO(event.start_utc, { zone: "utc" });
          endDtInternal = luxon.DateTime.fromISO(event.end_utc, { zone: "utc" });
        }
        if (!startDtInternal.isValid || !endDtInternal.isValid) {
          // console.warn("Invalid date in event during processing for render:", event.id, startDtInternal.invalidReason, endDtInternal.invalidReason);
          return null;
        }
        // Ensure end is not before start for internal processing
        if (endDtInternal < startDtInternal) {
          // console.warn("Correcting end date before start date for event:", event.id);
          endDtInternal = startDtInternal;
        }
        return { ...event, _startDt: startDtInternal, _endDt: endDtInternal, _isAllDay: isAllDay };
      } catch (e) {
        console.warn("Error processing event for rendering:", event, e);
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
    }
  });

  if (processedEvents.length === 0 && currentView !== "day") {
    if (typeof addDragAndDropListeners === "function") addDragAndDropListeners();
    if (typeof window.addEventResizeListeners === "function") window.addEventResizeListeners();
    return;
  }

  const viewConfig = {
    displayZone: appDisplayTimezone,
    overlayHeight: currentView === "year" ? 5 : currentView === "month" || currentView === "day" ? 18 : 18,
    verticalSpacing: currentView === "year" ? 1 : currentView === "month" || currentView === "day" ? 3 : 2,
    countBoxHeight: currentView === "year" ? 12 : 20,
    maxPlacementLevels: currentView === "year" ? 3 : 3,
    hourHeightPx: 40,
  };

  if (currentView === "year" || currentView === "month") {
    viewConfig.viewName = currentView;
    renderMonthYearViewEvents(processedEvents, viewConfig);
  } else if (currentView === "week" || currentView === "day") {
    viewConfig.viewName = currentView;
    const dayColumns = args[0];
    if (dayColumns && dayColumns.length > 0) {
      renderWeekViewEvents(processedEvents, viewConfig, dayColumns);
    } else {
      const queriedColumns = Array.from(calendarContainer.querySelectorAll(".week-day-column"));
      if (queriedColumns.length > 0) {
        renderWeekViewEvents(processedEvents, viewConfig, queriedColumns);
      } else {
        console.error("renderEventVisuals: Week/Day view columns not available for rendering.");
      }
    }
  }

  if (typeof addDragAndDropListeners === "function") addDragAndDropListeners();
  else console.error("addDragAndDropListeners func not found!");
  if (typeof window.addEventResizeListeners === "function") window.addEventResizeListeners();
  else console.error("addEventResizeListeners func not found!");
}
window.renderEventVisuals = renderEventVisuals;
