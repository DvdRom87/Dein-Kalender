const calendarContainer = document.getElementById("calendar-container");
const navigationButtons = document.querySelector(".navigation-buttons");
const currentViewTitle = document.getElementById("current-view-title");

let currentView = "year";
let currentMonth = luxon.DateTime.now().month - 1;
let currentDay = luxon.DateTime.now().day;
let currentYear = luxon.DateTime.now().year;
let appDisplayTimezone = luxon.DateTime.local().zoneName;

const GERMAN_MONTH_NAMES = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const GERMAN_DAY_NAMES_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
let monthCardGeometryCaches = new Map();

window.clearCalendarGeometryCache = (isViewSwitch = false) => {
  monthCardGeometryCaches.clear();
};

window.getCurrentMonth = () => currentMonth;

function _generateMonthCardId(year, monthIndex) {
  return `month-card-${year}-${monthIndex}`;
}

function _cacheCellGeometriesForCard(monthCardElement, allGridCellsInCard, cardId) {
  const cardCache = new Map();
  if (!monthCardElement || !allGridCellsInCard || allGridCellsInCard.length === 0) {
    monthCardGeometryCaches.set(cardId, cardCache);
    return;
  }
  const monthCardRect = monthCardElement.getBoundingClientRect();
  allGridCellsInCard.forEach((cell) => {
    if (cell.dataset.position && (cell.classList.contains("day") || cell.classList.contains("empty-day"))) {
      const cellRect = cell.getBoundingClientRect();
      cardCache.set(cell.dataset.position, {
        date: cell.dataset.date,
        left: cellRect.left - monthCardRect.left,
        top: cellRect.top - monthCardRect.top,
        width: cellRect.width,
        height: cellRect.height,
        right: cellRect.right - monthCardRect.left,
        bottom: cellRect.bottom - monthCardRect.top,
      });
    }
  });
  monthCardGeometryCaches.set(cardId, cardCache);
}

function _createMonthGridDOM(year, monthIndex) {
  const monthLuxon = luxon.DateTime.local(year, monthIndex + 1, 1, { zone: appDisplayTimezone });
  const monthCard = document.createElement("div");
  monthCard.classList.add("month-card");
  monthCard.id = _generateMonthCardId(year, monthIndex);

  const monthTitleElement = document.createElement("h2");
  monthTitleElement.classList.add("month-title");
  monthTitleElement.textContent = `${GERMAN_MONTH_NAMES[monthIndex]} ${year}`;
  monthCard.appendChild(monthTitleElement);

  const calendarGrid = document.createElement("div");
  calendarGrid.classList.add("calendar-grid");

  const dayNamesRowFragment = document.createDocumentFragment();
  const kwHeaderEl = document.createElement("div");
  kwHeaderEl.classList.add("kw-cell");
  dayNamesRowFragment.appendChild(kwHeaderEl);
  GERMAN_DAY_NAMES_SHORT.forEach((dayName) => {
    const el = document.createElement("div");
    el.classList.add("day-name");
    el.textContent = dayName;
    dayNamesRowFragment.appendChild(el);
  });
  calendarGrid.appendChild(dayNamesRowFragment);

  const firstDayOfMonth = monthLuxon.startOf("month");
  const daysInMonth = monthLuxon.daysInMonth;
  let startingDayOfWeek = firstDayOfMonth.weekday - 1;
  if (startingDayOfWeek < 0) startingDayOfWeek = 6;

  let dayCounterForPositionDataset = 0;
  const dayAndEmptyCells = [];

  const todayDt = luxon.DateTime.now().setZone(appDisplayTimezone).startOf("day");

  for (let i = 0; i < startingDayOfWeek; i++) {
    const el = document.createElement("div");
    el.classList.add("day", "empty-day");
    el.dataset.position = String(dayCounterForPositionDataset++);
    dayAndEmptyCells.push(el);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const el = document.createElement("div");
    el.classList.add("day");
    el.textContent = String(day);
    const currentDateDt = luxon.DateTime.local(year, monthIndex + 1, day, { zone: appDisplayTimezone });
    el.dataset.date = currentDateDt.toFormat("yyyy-MM-dd");
    el.dataset.position = String(dayCounterForPositionDataset++);
    if (currentDateDt.weekday === 6 || currentDateDt.weekday === 7) el.classList.add("weekend");
    if (currentDateDt.hasSame(todayDt, "day")) el.classList.add("today");
    if (typeof handleDayClick === "function") el.addEventListener("click", handleDayClick);
    dayAndEmptyCells.push(el);
  }

  const totalRenderedCells = startingDayOfWeek + daysInMonth;
  const remainingCellsToFillLastRow = (7 - (totalRenderedCells % 7)) % 7;
  for (let i = 0; i < remainingCellsToFillLastRow; i++) {
    const el = document.createElement("div");
    el.classList.add("day", "empty-day");
    el.dataset.position = String(dayCounterForPositionDataset++);
    dayAndEmptyCells.push(el);
  }

  const finalGridContentFragment = document.createDocumentFragment();
  dayAndEmptyCells.forEach((cellNode, index) => {
    if (index % 7 === 0) {
      let dateForWeekNumberCalc;
      let firstDayNodeInRow = null;
      for (let i = 0; i < 7; i++) {
        const cellIndexInRow = index + i;
        if (cellIndexInRow < dayAndEmptyCells.length && dayAndEmptyCells[cellIndexInRow].dataset.date) {
          firstDayNodeInRow = dayAndEmptyCells[cellIndexInRow];
          break;
        }
      }

      if (firstDayNodeInRow) {
        dateForWeekNumberCalc = luxon.DateTime.fromISO(firstDayNodeInRow.dataset.date, { zone: appDisplayTimezone });
      } else {
        if (index < startingDayOfWeek) {
          dateForWeekNumberCalc = firstDayOfMonth;
        } else {
          dateForWeekNumberCalc = luxon.DateTime.local(year, monthIndex + 1, daysInMonth, { zone: appDisplayTimezone });
        }
      }

      const weekNumber = dateForWeekNumberCalc && dateForWeekNumberCalc.isValid ? dateForWeekNumberCalc.weekNumber : "";
      const kwCell = document.createElement("div");
      kwCell.classList.add("kw-cell");
      kwCell.textContent = String(weekNumber);
      finalGridContentFragment.appendChild(kwCell);
    }
    finalGridContentFragment.appendChild(cellNode);
  });

  calendarGrid.appendChild(finalGridContentFragment);
  monthCard.appendChild(calendarGrid);
  monthCard._tempGridCellsForCache = dayAndEmptyCells;
  return monthCard;
}

function generateYearView(year) {
  calendarContainer.innerHTML = "";
  calendarContainer.className = "calendar-container year-view";
  window.clearCalendarGeometryCache(true);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 12; i++) frag.appendChild(_createMonthGridDOM(year, i));
  calendarContainer.appendChild(frag);
  calendarContainer.querySelectorAll(".month-card").forEach((card) => {
    if (card._tempGridCellsForCache) {
      _cacheCellGeometriesForCard(card, card._tempGridCellsForCache, card.id);
      delete card._tempGridCellsForCache;
    }
    const grid = card.querySelector(".calendar-grid");
    if (grid) {
      grid.addEventListener("mouseover", handleGridMouseOver);
      grid.addEventListener("mouseout", handleGridMouseOut);
    }
  });
  return null; // Explicitly return null as it doesn't produce specific column elements for renderer
}

function generateMonthView(year, monthIndex) {
  calendarContainer.innerHTML = "";
  calendarContainer.className = "calendar-container month-view";
  window.clearCalendarGeometryCache(true);
  const card = _createMonthGridDOM(year, monthIndex);
  calendarContainer.appendChild(card);
  if (card._tempGridCellsForCache) {
    _cacheCellGeometriesForCard(card, card._tempGridCellsForCache, card.id);
    delete card._tempGridCellsForCache;
  }
  const grid = card.querySelector(".calendar-grid");
  if (grid) {
    grid.addEventListener("mouseover", handleGridMouseOver);
    grid.addEventListener("mouseout", handleGridMouseOut);
  }
  return null; // Explicitly return null
}

function generateWeekView(year, monthIndex, day) {
  calendarContainer.innerHTML = "";
  calendarContainer.className = "calendar-container week-view";
  monthCardGeometryCaches.clear(); // Clear month/year specific cache

  let localWeekViewDayColumnElements = []; // Use a local variable

  const todayDt = luxon.DateTime.now().setZone(appDisplayTimezone).startOf("day");
  const currentDayDt = luxon.DateTime.local(year, monthIndex + 1, day, { zone: appDisplayTimezone });
  const startOfWeek = currentDayDt.startOf("week");
  const endOfWeek = currentDayDt.endOf("week");

  const weekGridContainer = document.createElement("div");
  weekGridContainer.className = "week-grid-scroll-container";
  const weekGrid = document.createElement("div");
  weekGrid.className = "week-grid-content";

  const headerRow = document.createElement("div");
  headerRow.className = "week-header-row";
  const timeGutterCorner = document.createElement("div");
  timeGutterCorner.className = "time-axis-gutter week-header-corner";
  timeGutterCorner.textContent = `KW ${startOfWeek.weekNumber}`;
  headerRow.appendChild(timeGutterCorner);

  for (let i = 0; i < 7; i++) {
    const dayInWeek = startOfWeek.plus({ days: i });
    const dayHeader = document.createElement("div");
    dayHeader.className = "week-day-header";
    dayHeader.dataset.date = dayInWeek.toFormat("yyyy-MM-dd");
    dayHeader.innerHTML = `<span class="day-name-short">${GERMAN_DAY_NAMES_SHORT[i]}</span> <span class="day-date-num">${dayInWeek.toFormat("dd.MM.")}</span>`;
    if (dayInWeek.hasSame(todayDt, "day")) dayHeader.classList.add("today");
    if (dayInWeek.weekday === 6 || dayInWeek.weekday === 7) dayHeader.classList.add("weekend");
    if (typeof handleDayClick === "function") dayHeader.addEventListener("click", handleDayClick);
    headerRow.appendChild(dayHeader);
  }
  weekGrid.appendChild(headerRow);

  const allDayRow = document.createElement("div");
  allDayRow.className = "week-all-day-row";
  const allDayLabelCell = document.createElement("div");
  allDayLabelCell.className = "time-axis-gutter week-all-day-label";
  allDayLabelCell.textContent = "Ganztägig";
  allDayRow.appendChild(allDayLabelCell);

  for (let i = 0; i < 7; i++) {
    const dayInWeek = startOfWeek.plus({ days: i });
    const allDayCell = document.createElement("div");
    allDayCell.className = "week-all-day-slot";
    allDayCell.dataset.date = dayInWeek.toFormat("yyyy-MM-dd");
    if (dayInWeek.weekday === 6 || dayInWeek.weekday === 7) allDayCell.classList.add("weekend");
    if (dayInWeek.hasSame(todayDt, "day")) allDayCell.classList.add("today");
    if (typeof handleDayClick === "function") allDayCell.addEventListener("click", handleDayClick);
    allDayRow.appendChild(allDayCell);
  }
  weekGrid.appendChild(allDayRow);

  const mainContentRow = document.createElement("div");
  mainContentRow.className = "week-main-content-row";

  const timeAxisGutter = document.createElement("div");
  timeAxisGutter.className = "time-axis-gutter week-time-labels";
  for (let hour = 0; hour < 24; hour++) {
    const hourLabel = document.createElement("div");
    hourLabel.className = "hour-label";
    hourLabel.textContent = `${String(hour).padStart(2, "0")}:00`;
    timeAxisGutter.appendChild(hourLabel);
  }
  mainContentRow.appendChild(timeAxisGutter);

  const daysContainer = document.createElement("div");
  daysContainer.className = "week-days-container";

  for (let i = 0; i < 7; i++) {
    const dayInWeek = startOfWeek.plus({ days: i });
    const dayColumn = document.createElement("div");
    dayColumn.className = "week-day-column";
    dayColumn.dataset.date = dayInWeek.toFormat("yyyy-MM-dd");
    if (dayInWeek.hasSame(todayDt, "day")) dayColumn.classList.add("today");
    if (dayInWeek.weekday === 6 || dayInWeek.weekday === 7) dayColumn.classList.add("weekend");

    for (let hour = 0; hour < 24; hour++) {
      const hourSlot = document.createElement("div");
      hourSlot.className = "hour-slot";
      hourSlot.dataset.time = `${String(hour).padStart(2, "0")}:00`;
      hourSlot.dataset.date = dayInWeek.toFormat("yyyy-MM-dd");
      if (typeof handleDayClick === "function") {
        hourSlot.addEventListener("click", (e) => {
          const targetSlot = e.currentTarget;
          if (targetSlot && targetSlot.dataset.date) {
            window.handleDayClick({ target: targetSlot });
          }
        });
      }
      dayColumn.appendChild(hourSlot);
    }
    daysContainer.appendChild(dayColumn);
    localWeekViewDayColumnElements.push(dayColumn); // Populate local array
  }
  mainContentRow.appendChild(daysContainer);
  weekGrid.appendChild(mainContentRow);
  weekGridContainer.appendChild(weekGrid);
  calendarContainer.appendChild(weekGridContainer);

  currentViewTitle.textContent = `KW ${startOfWeek.weekNumber}: ${startOfWeek.toFormat("dd.MM.")} - ${endOfWeek.toFormat("dd.MM.yyyy")}`;
  return localWeekViewDayColumnElements; // Return the populated elements
}

function generateDayView(year, monthIndex, day) {
  calendarContainer.innerHTML = "";
  calendarContainer.className = "calendar-container day-view";
  window.clearCalendarGeometryCache(true);
  const title = document.createElement("h2");
  title.classList.add("day-title");
  title.textContent = `${day}. ${GERMAN_MONTH_NAMES[monthIndex]} ${year}`;
  calendarContainer.appendChild(title);
  const dateStr = luxon.DateTime.local(year, monthIndex + 1, day, { zone: appDisplayTimezone }).toFormat("yyyy-MM-dd");
  const eventsForDay = typeof getEventsForDate === "function" ? getEventsForDate(dateStr) : [];
  const listEl = document.createElement("ul");
  listEl.classList.add("event-list");
  if (eventsForDay.length > 0) {
    eventsForDay.sort((a, b) => (a.start_utc ? luxon.DateTime.fromISO(a.start_utc).toMillis() : luxon.DateTime.fromISO(a.start, { zone: appDisplayTimezone }).startOf("day").toMillis()) - (b.start_utc ? luxon.DateTime.fromISO(b.start_utc).toMillis() : luxon.DateTime.fromISO(b.start, { zone: appDisplayTimezone }).startOf("day").toMillis()));
    const frag = document.createDocumentFragment();
    eventsForDay.forEach((event) => {
      const li = document.createElement("li");
      li.dataset.eventId = event.id;
      const isAllDay = !event.start_utc;
      const fmtDateTime = typeof DateUtils !== "undefined" && typeof DateUtils.formatDateTimeRange === "function" ? DateUtils.formatDateTimeRange(event, isAllDay, appDisplayTimezone) : `${event.start} - ${event.end}`;

      // Escape the event name for safety
      const eventNameDisplay = event.name ? DateUtils.escapeIcsField(event.name) : "Unbenanntes Ereignis";

      let descriptionHtml = "";
      if (event.description) {
        // Use HtmlUtils
        descriptionHtml = HtmlUtils.sanitizeHtml(event.description);
      }

      li.innerHTML = `
        <span class="event-color-dot" style="background-color: ${event.color || "#3b82f6"};"></span>
        <div class="event-details">
          <strong>${eventNameDisplay}</strong>
          <span>${fmtDateTime}</span>
          ${descriptionHtml ? `<div class="event-description-html-content">${descriptionHtml}</div>` : ""}
        </div>`;
      if (typeof openModal === "function") li.addEventListener("click", () => openModal("form", event.id));
      frag.appendChild(li);
    });
    listEl.appendChild(frag);
  } else {
    const msg = document.createElement("p");
    msg.classList.add("no-events-message");
    msg.textContent = "Keine Ereignisse an diesem Tag.";
    listEl.appendChild(msg);
  }
  calendarContainer.appendChild(listEl);
  return null;
}

function applyStaticDayStyling(publicHolidays, schoolHolidays) {
  const dayElementsSelector = currentView === "week" ? ".week-day-header[data-date], .week-day-column[data-date], .week-all-day-slot[data-date]" : ".day[data-date]";

  document.querySelectorAll(dayElementsSelector).forEach((dayEl) => {
    dayEl.classList.remove("holiday", "school-holiday");
    let title = "";
    const date = dayEl.dataset.date;
    if (publicHolidays && publicHolidays[date]) {
      dayEl.classList.add("holiday");
      title += publicHolidays[date].name;
    }
    if (schoolHolidays && schoolHolidays[date]) {
      dayEl.classList.add("school-holiday");
      title += (title ? "\n" : "") + `Schulferien: ${schoolHolidays[date].name}`;
    }

    if (dayEl.classList.contains("week-day-column") && dayEl.title && title) {
      dayEl.title = dayEl.title.includes(title) ? dayEl.title : (dayEl.title + (dayEl.title ? "\n" : "") + title).trim();
    } else {
      dayEl.title = title.trim() || "";
    }

    if (dayEl.classList.contains("week-day-column") && (dayEl.classList.contains("holiday") || dayEl.classList.contains("school-holiday"))) {
      dayEl.querySelectorAll(".hour-slot").forEach((slot) => {
        if (dayEl.classList.contains("holiday")) slot.classList.add("holiday");
        if (dayEl.classList.contains("school-holiday")) slot.classList.add("school-holiday");
      });
    }
  });
}

function handleGridMouseOver(event) {
  if (currentView === "week") return;
  const day = event.target.closest(".day:not(.empty-day)");
  if (!day || !day.dataset.position) return;
  const grid = day.closest(".calendar-grid");
  if (!grid) return;
  grid.querySelectorAll(".day.week-hover").forEach((d) => d.classList.remove("week-hover"));
  const dayPositionIn7DaySequence = parseInt(day.dataset.position, 10);
  const startPosIn7DaySequence = Math.floor(dayPositionIn7DaySequence / 7) * 7;
  for (let i = 0; i < 7; i++) {
    const d = grid.querySelector(`.day[data-position="${startPosIn7DaySequence + i}"]`);
    if (d) d.classList.add("week-hover");
  }
}

function handleGridMouseOut(event) {
  if (currentView === "week") return;
  const day = event.target.closest(".day");
  const grid = event.currentTarget;
  const related = event.relatedTarget ? event.relatedTarget.closest(".day") : null;
  if (!day || !grid.contains(event.relatedTarget) || !related || !related.dataset.position || !day.dataset.position) {
    grid.querySelectorAll(".day.week-hover").forEach((d) => d.classList.remove("week-hover"));
    return;
  }
  const currentDayPos = parseInt(day.dataset.position, 10);
  const relatedDayPos = parseInt(related.dataset.position, 10);
  if (Math.floor(currentDayPos / 7) !== Math.floor(relatedDayPos / 7)) {
    grid.querySelectorAll(".day.week-hover").forEach((d) => d.classList.remove("week-hover"));
  }
}

window.setInitialCalendarState = function (year, monthIndex, day, view) {
  currentYear = year;
  currentMonth = monthIndex;
  currentDay = day;
  currentView = view;
};

async function updateCalendar(forceFullRedraw = false) {
  const yearVal = parseInt(yearSelect.value, 10);
  const stateVal = stateSelect.value;
  const viewVal = viewSelect.value;

  if (isNaN(yearVal)) {
    calendarContainer.innerHTML = "<p style='text-align:center;color:red;'>Ungültiges Jahr.</p>";
    return;
  }

  let dateChanged = false;
  const oldDtForContext = luxon.DateTime.local(currentYear, currentMonth + 1, currentDay, { zone: appDisplayTimezone });
  const previousView = currentView;

  if (viewVal !== currentView) forceFullRedraw = true;
  currentView = viewVal;

  if (yearVal !== currentYear) {
    currentYear = yearVal;
    dateChanged = true;
    if (currentView === "month" || currentView === "year") {
      currentMonth = 0;
      currentDay = 1;
    } else if (currentView === "week") {
      const firstDayOfYear = luxon.DateTime.local(currentYear, 1, 1, { zone: appDisplayTimezone });
      currentMonth = firstDayOfYear.month - 1;
      currentDay = firstDayOfYear.day;
    } else {
      currentMonth = 0;
      currentDay = 1;
    }
  }

  const newDtForContext = luxon.DateTime.local(currentYear, currentMonth + 1, currentDay, { zone: appDisplayTimezone });
  if (!dateChanged && previousView === currentView) {
    if (currentView === "month" && oldDtForContext.month !== newDtForContext.month) dateChanged = true;
    else if (currentView === "week" && oldDtForContext.startOf("week").toISODate() !== newDtForContext.startOf("week").toISODate()) dateChanged = true;
    else if (currentView === "day" && oldDtForContext.toISODate() !== newDtForContext.toISODate()) dateChanged = true;
  }

  const structChange = forceFullRedraw || dateChanged;
  navigationButtons.style.display = currentView === "year" ? "none" : "flex";

  let generatedViewElements = null; // To hold elements returned by generate...View funcs

  if (structChange) {
    window.clearCalendarGeometryCache(previousView !== currentView);
    if (currentView === "year") generateYearView(currentYear);
    else if (currentView === "month") generateMonthView(currentYear, currentMonth);
    else if (currentView === "week") generatedViewElements = generateWeekView(currentYear, currentMonth, currentDay);
    else if (currentView === "day") generateDayView(currentYear, currentMonth, currentDay);
  } else if (currentView === "week") {
    generatedViewElements = Array.from(calendarContainer.querySelectorAll(".week-day-column"));
  }

  // Update Title
  if (currentView === "year") currentViewTitle.textContent = `${currentYear}`;
  else if (currentView === "month") currentViewTitle.textContent = `${GERMAN_MONTH_NAMES[currentMonth]} ${currentYear}`;
  else if (currentView === "week") {
    const dtForWeekTitle = newDtForContext;
    const startOfWeek = dtForWeekTitle.startOf("week");
    const endOfWeek = dtForWeekTitle.endOf("week");
    currentViewTitle.textContent = `KW ${startOfWeek.weekNumber}: ${startOfWeek.toFormat("dd.MM.")} - ${endOfWeek.toFormat("dd.MM.yyyy")}`;
  } else currentViewTitle.textContent = `${currentDay}. ${GERMAN_MONTH_NAMES[currentMonth]} ${currentYear}`;

  if (currentView === "day") {
    if (typeof clearEventOverlaysAndCountBoxes === "function") clearEventOverlaysAndCountBoxes();
    stateSelect.dataset.prevState = stateVal;
    return;
  }

  const stateChanged = stateSelect.dataset.prevState !== stateVal;
  let yearForHolidayFetch = currentYear;
  let relevantYearsForSchoolHolidays = [currentYear];

  if (currentView === "week") {
    const currentWeekStart = newDtForContext.startOf("week");
    yearForHolidayFetch = currentWeekStart.year;
    const currentWeekEnd = newDtForContext.endOf("week");
    if (currentWeekStart.year !== currentWeekEnd.year) {
      relevantYearsForSchoolHolidays = [currentWeekStart.year, currentWeekEnd.year];
    }
  } else if (currentView === "month") {
    // For school holidays, fetch previous year if current month is Jan, next year if Dec
    // to catch holidays spanning year boundaries (e.g. Christmas break)
    // Luxon month is 1-indexed. newDtForContext.month gives 1 for Jan, 12 for Dec.
    if (newDtForContext.month === 1) {
      // January
      relevantYearsForSchoolHolidays.push(currentYear - 1);
    }
    if (newDtForContext.month === 12) {
      // December
      relevantYearsForSchoolHolidays.push(currentYear + 1);
    }
  }

  let holidayDataNeedsUpdate = structChange || stateChanged;
  if (!holidayDataNeedsUpdate && (currentView === "week" || currentView === "month")) {
    const oldYearForHolidayFetch = oldDtForContext.startOf(currentView === "week" ? "week" : "month").year;
    if (yearForHolidayFetch !== oldYearForHolidayFetch) {
      holidayDataNeedsUpdate = true;
    }
  }

  if (holidayDataNeedsUpdate) {
    let publicHolidays = {},
      schoolHolidays = {};
    if (stateVal && typeof fetchPublicHolidays === "function" && typeof fetchSchoolHolidays === "function") {
      try {
        const uniqueYearsToFetchPublic = [...new Set([yearForHolidayFetch, ...relevantYearsForSchoolHolidays])];
        const publicHolidayPromises = uniqueYearsToFetchPublic.map((yr) => fetchPublicHolidays(yr, stateVal));

        const uniqueYearsToFetchSchool = [...new Set(relevantYearsForSchoolHolidays)];
        const schoolHolidayPromises = uniqueYearsToFetchSchool.map((yr) => fetchSchoolHolidays(yr, stateVal));

        const [publicHolidaysResults, schoolHolidaysResults] = await Promise.all([Promise.all(publicHolidayPromises), Promise.all(schoolHolidayPromises)]);

        publicHolidays = Object.assign({}, ...publicHolidaysResults);
        schoolHolidays = Object.assign({}, ...schoolHolidaysResults);
      } catch (error) {
        console.error("Error fetching holiday data:", error);
      }
    }
    applyStaticDayStyling(publicHolidays, schoolHolidays);
    stateSelect.dataset.prevState = stateVal;
  }

  const renderArgs = currentView === "week" && generatedViewElements ? [generatedViewElements] : [];

  if (typeof renderEventVisuals === "function") {
    Promise.resolve().then(() => {
      requestAnimationFrame(() => renderEventVisuals(...renderArgs));
    });
  } else {
    console.error("renderEventVisuals func not found in calendarGrid.js");
  }
}
window.updateCalendar = updateCalendar;

window.navigate = function (direction) {
  let dt = luxon.DateTime.local(currentYear, currentMonth + 1, currentDay, { zone: appDisplayTimezone });
  if (currentView === "month") dt = dt.plus({ months: direction });
  else if (currentView === "week") dt = dt.plus({ weeks: direction });
  else if (currentView === "day") dt = dt.plus({ days: direction });

  const prevYear = currentYear;
  currentYear = dt.year;
  currentMonth = dt.month - 1;
  currentDay = dt.day;

  if (prevYear !== currentYear) {
    let optionExists = Array.from(yearSelect.options).some((opt) => opt.value === String(currentYear));
    if (!optionExists) {
      const newOption = document.createElement("option");
      newOption.value = currentYear;
      newOption.textContent = currentYear;
      let inserted = false;
      for (let i = 0; i < yearSelect.options.length; i++) {
        if (currentYear < parseInt(yearSelect.options[i].value)) {
          yearSelect.insertBefore(newOption, yearSelect.options[i]);
          inserted = true;
          break;
        }
      }
      if (!inserted) yearSelect.appendChild(newOption);
      yearSelect.value = String(currentYear);
    } else {
      yearSelect.value = String(currentYear);
    }
    updateCalendar(true);
  } else {
    updateCalendar(true);
  }
};
