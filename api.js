async function fetchPublicHolidays(year, stateCode) {
  if (!stateCode) {
    return {};
  }
  const apiUrl = `https://feiertage-api.de/api/?jahr=${year}&nur_land=${stateCode}`;
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      console.warn(`Could not fetch public holidays for ${year} and ${stateCode}. Status: ${response.status}`);
      return {};
    }
    const data = await response.json();
    const holidaysMap = {};
    for (const holidayName in data) {
      if (data.hasOwnProperty(holidayName) && data[holidayName].datum) {
        holidaysMap[data[holidayName].datum] = { name: holidayName };
      }
    }
    return holidaysMap;
  } catch (error) {
    console.error("Error fetching public holidays:", error);
    return {};
  }
}

async function fetchSchoolHolidays(year, stateCode) {
  if (!stateCode) {
    return {};
  }
  const schoolHolidaysMap = {};
  const yearsToFetch = [year, year - 1];

  for (const fetchYear of yearsToFetch) {
    const apiUrl = `https://ferien-api.maxleistner.de/api/v1/${fetchYear}/${stateCode}`;
    try {
      const response = await fetch(apiUrl);
      if (!response.ok) {
        continue;
      }
      const data = await response.json();
      if (data && data.length > 0) {
        data.forEach((holidayPeriod) => {
          if (holidayPeriod.start && holidayPeriod.end && holidayPeriod.name) {
            const startStr = holidayPeriod.start.split("T")[0];
            const endStr = holidayPeriod.end.split("T")[0];
            const startParts = startStr.split("-").map(Number);
            const endParts = endStr.split("-").map(Number);
            const startDateUtc = new Date(Date.UTC(startParts[0], startParts[1] - 1, startParts[2]));
            const exclusiveApiEndDateUtc = new Date(Date.UTC(endParts[0], endParts[1] - 1, endParts[2]));

            if (startDateUtc >= exclusiveApiEndDateUtc) {
              return;
            }
            for (let d = new Date(startDateUtc); d < exclusiveApiEndDateUtc; d.setUTCDate(d.getUTCDate() + 1)) {
              const currentDayIterYear = d.getUTCFullYear();
              if (currentDayIterYear === year) {
                const month = (d.getUTCMonth() + 1).toString().padStart(2, "0");
                const day = d.getUTCDate().toString().padStart(2, "0");
                const dateString = `${year}-${month}-${day}`;
                schoolHolidaysMap[dateString] = { name: holidayPeriod.name };
              }
            }
          }
        });
      }
    } catch (error) {
      console.error(`Error fetching school holidays for ${stateCode}/${fetchYear}:`, error);
    }
  }
  return schoolHolidaysMap;
}
