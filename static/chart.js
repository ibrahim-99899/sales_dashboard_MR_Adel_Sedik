const svg = d3.select("#chart"),
  width = +svg.attr("width"),
  height = +svg.attr("height"),
  margin = { top: 30, right: 80, bottom: 30, left: 130 };

const chartWidth = width - margin.left - margin.right;
const chartHeight = height - margin.top - margin.bottom;

const g = svg
  .append("g")
  .attr("transform", `translate(${margin.left},${margin.top})`);

const x = d3.scaleLinear().range([0, chartWidth]);
const y = d3.scaleBand().range([0, chartHeight]).padding(0.5);

let isVideoPlaying = false;
let pollingInterval = null;
let previousRanks = {};
let previousSales = {};
let isFirstRun = true;

const saleSound = new Audio("/static/sounds/sale.mp3");
const rankUpSound = new Audio("/static/sounds/rank-up.mp3");

let monthlyTargets = {};
let peopleMap = {};

async function loadPeopleData() {
  try {
    const res = await fetch("/people");
    peopleMap = await res.json();
  } catch (err) {
    console.error("Failed to load people data:", err);
  }
}

function capitalizeName(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function flashBar(name) {
  const rect = g.selectAll("rect").filter((d) => d.Name === name);
  rect.classed("flash-bar", false);
  void rect.node().offsetWidth;
  rect.classed("flash-bar", true);
  setTimeout(() => {
    rect.classed("flash-bar", false);
  }, 7500);
}

// async function fetchGoals() {
//   try {
//     const res = await fetch("/goals");
//     const goals = await res.json();
//     const now = new Date();
//     monthlyTargets = {};

//     for (const g of goals) {
//       const goalName = g["Goal Name"]; // مثل: "Target (Sohaila)"
//       const extractedName = goalName.match(/\((.*?)\)/)?.[1]; // "Sohaila"

//       if (!extractedName) continue;

//       const fullNameMatch = Object.keys(peopleMap).find((name) =>
//         name.toLowerCase().includes(extractedName.toLowerCase())
//       );

//       const short = peopleMap[fullNameMatch]?.short;

//       if (!short) continue;

//       const start = new Date(g.Start);
//       const end = new Date(g.End);

//       if (now >= start && now <= end) {
//         const current = monthlyTargets[short];
//         if (!current || new Date(g.Start) > new Date(current.Start)) {
//           monthlyTargets[short] = {
//             Target: parseFloat(g.Target),
//             Start: g.Start,
//           };
//         }
//       }
//     }

//     Object.keys(monthlyTargets).forEach((k) => {
//       monthlyTargets[k] = monthlyTargets[k].Target;
//     });

//     console.log("Loaded Targets:", monthlyTargets);
//   } catch (err) {
//     console.error("Error fetching goals:", err);
//   }
// }

async function fetchGoals() {
  try {
    const res = await fetch("/goals");
    const goals = await res.json();
    const now = new Date();
    monthlyTargets = {};

    for (const g of goals) {
      const goalName = g["Goal Name"]; // مثل: "Target (Sohaila)"
      const extractedName = goalName.match(/\((.*?)\)/)?.[1]; // "Sohaila"
      if (!extractedName) continue;

      // بدّلنا الـ includes بدالة تربط الـ short مباشرة
      const fullNameMatch = Object.keys(peopleMap).find(
        (name) => peopleMap[name]?.goal_name?.includes(extractedName)
      );

      if (!fullNameMatch) continue;

      const short = peopleMap[fullNameMatch]?.short;

      if (!short) continue;

      const start = new Date(g.Start);
      const end = new Date(g.End);

      if (now >= start && now <= end) {
        const current = monthlyTargets[short];
        if (!current || new Date(g.Start) > new Date(current.Start)) {
          monthlyTargets[short] = {
            Target: parseFloat(g.Target),
            Start: g.Start,
          };
        }
      }
    }

    Object.keys(monthlyTargets).forEach((k) => {
      monthlyTargets[k] = monthlyTargets[k].Target;
    });

    console.log("Loaded Targets:", monthlyTargets);
  } catch (err) {
    console.error("Error fetching goals:", err);
  }
}


function updateChart(data, delayBars = false, highlightName = null) {
  console.log("Data with calculated Percentages:", data);

  data.forEach((d) => {
    d.Sales = Number(d.Sales);
    const fullName = Object.keys(peopleMap).find(
      (name) => peopleMap[name].short === d.Name
    );
    const short = peopleMap[fullName]?.short || d.Name;

    const target = monthlyTargets[short] || 0;
    d.Percent = target > 0 ? (d.Sales / target) * 100 : 0;
  });

  x.domain([0, d3.max(data, (d) => d.Sales)]);
  y.domain(data.map((d) => d.Name));

  const barTransition = g
    .transition()
    .duration(3500)
    .delay(delayBars ? 1000 : 0);

  const bars = g.selectAll("rect").data(data, (d) => d.Name);
  bars.join(
    (enter) =>
      enter
        .append("rect")
        .attr("x", 0)
        .attr("y", (d) => y(d.Name))
        .attr("height", y.bandwidth())
        .attr("width", 0)
        .attr("fill", "#ff9933")
        .attr("rx", 8)
        .transition(barTransition)
        .attr("width", (d) => x(d.Sales) * 0.95),
    (update) =>
      update
        .transition(barTransition)
        .attr("y", (d) => y(d.Name))
        .attr("width", (d) => x(d.Sales) * 0.95)
        .attr("height", y.bandwidth())
  );
  bars.exit().transition().duration(800).attr("width", 0).remove();

  g.selectAll(".label-outside").remove();

  g.selectAll(".label-outside")
    .data(data, (d) => d.Name)
    .join(
      (enter) =>
        enter
          .append("text")
          .attr("class", "label-outside")
          .attr("fill", "#ffffff")
          .attr("font-size", "22px")
          .attr("font-weight", "bold")
          .attr("y", (d) => y(d.Name) + y.bandwidth() / 2 + 6)
          .attr("x", (d) => x(d.Sales) * 0.95 - 70)
          .text((d) => `${d.Percent.toFixed(1)}%`)
          .call((text) => {
            if (isFirstRun) {
              text
                .transition(barTransition)
                .attr("x", (d) => x(d.Sales) * 0.95 - 70);
            }
          }),
      (update) =>
        update
          .attr("y", (d) => y(d.Name) + y.bandwidth() / 2 + 6)
          .attr("x", (d) => x(d.Sales) * 0.95 - 70)
          .text((d) => `${d.Percent.toFixed(1)}%`)
    );

  g.selectAll(".y-axis").remove();
  g.selectAll(".y-label-group").remove();

  g.append("g")
    .attr("class", "y-axis")
    .call(d3.axisLeft(y).tickFormat("").tickSize(0))
    .call((g) => g.select(".domain").remove());

  const labelGroups = g
    .selectAll(".y-label-group")
    .data(y.domain())
    .enter()
    .append("g")
    .attr("class", "y-label-group")
    .attr(
      "transform",
      (d) => `translate(-60, ${y(d) + y.bandwidth() / 2 - 15})`
    );

  const circleSize = 46;
  const iconGroup = labelGroups
    .append("g")
    .attr("class", "icon-group")
    .attr("transform", "translate(0, -5)");

  iconGroup.each(function (d, i) {
    const safeId = d.replace(/[^a-zA-Z0-9_-]/g, "_");
    const uid = `clip-${safeId}-${i}`;

    d3.select(this)
      .append("clipPath")
      .attr("id", uid)
      .append("circle")
      .attr("cx", circleSize / 2)
      .attr("cy", circleSize / 2)
      .attr("r", circleSize / 2);

    d3.select(this)
      .append("image")
      .attr("xlink:href", () => {
        const fullName = Object.keys(peopleMap).find(
          (key) => peopleMap[key].short === d
        );
        const fileId = peopleMap[fullName]?.file_id || "default";
        return `/static/uploads/icons/${fileId}-icon.png`;
      })
      .attr("width", circleSize)
      .attr("height", circleSize)
      .attr("x", 0)
      .attr("y", 0)
      .attr("clip-path", `url(#${uid})`);
  });

  labelGroups
    .append("text")
    .text((d) => {
      const fullName = Object.keys(peopleMap).find(
        (key) => peopleMap[key].short === d
      );
      return peopleMap[fullName]?.file_id || d;
    })
    .attr("x", circleSize + 20)
    .attr("y", 26)
    .attr("fill", "#ffffff")
    .attr("font-size", "26px")
    .attr("font-weight", "bold");

  if (highlightName) flashBar(highlightName);
}

async function fetchAndUpdate() {
  if (isVideoPlaying) return;

  try {
    const res = await fetch("/data");
    const json = await res.json();
    if (!Array.isArray(json) || json.length === 0 || !json[0]) return;

    let hasRankUp = false;
    let highlightName = null;

    if (!isFirstRun) {
      json.forEach((d, i) => {
        const prevRank = previousRanks[d.Name];
        const prevSales = previousSales[d.Name];
        const rankImproved = prevRank !== undefined && i < prevRank;
        const salesIncreased = prevSales !== undefined && d.Sales > prevSales;

        if (!isVideoPlaying) {
          if (rankImproved) {
            hasRankUp = true;
            rankUpSound.play();
          } else if (salesIncreased) {
            highlightName = d.Name;
            saleSound.play();
          }
        }

        previousRanks[d.Name] = i;
        previousSales[d.Name] = d.Sales;
      });

      updateTopSellerUI(json[0]);
      setTimeout(() => updateChart(json, hasRankUp, highlightName), 1000);
    } else {
      json.forEach((d, i) => {
        previousRanks[d.Name] = i;
        previousSales[d.Name] = d.Sales;
      });
      isFirstRun = false;
      updateChart(json);
      updateTopSellerUI(json[0]);
    }

    const topSeller = json[0];
    const previousTop = localStorage.getItem("lastTopSeller");

    if (topSeller.Name !== previousTop) {
      localStorage.setItem("lastTopSeller", topSeller.Name);
      isVideoPlaying = true;
      clearInterval(pollingInterval);

      await showVideoThenUpdate(topSeller, json);
      updateChart(json);
      updateTopSellerUI(topSeller);

      setTimeout(() => {
        isVideoPlaying = false;
        pollingInterval = setInterval(fetchAndUpdate, 6000);
      }, 10000);
    }
  } catch (error) {
    console.error("Error fetching data:", error);
  }
}

function updateTopSellerUI(topSeller) {
  const fullName = Object.keys(peopleMap).find(
    (name) => peopleMap[name].short === topSeller.Name
  );
  const person = peopleMap[fullName] || {};
  const fileId = person.file_id || "default";

  document.querySelector(".top-performer-name").textContent =
    person.short || topSeller.Name;
  document.getElementById("topImage").src = `/static/uploads/photos/${
    person.photo || `${fileId}.png`
  }`;
}

function showVideoThenUpdate(topSeller, fullData) {
  return new Promise((resolve) => {
    const videoPopup = document.getElementById("videoPopup");
    const video = document.getElementById("topVideo");

    const fullName = Object.keys(peopleMap).find(
      (name) => peopleMap[name].short === topSeller.Name
    );
    const person = peopleMap[fullName] || {};
    const fileId = person.file_id || "default";

    video.src = `/static/uploads/videos/${person.video || `${fileId}.mp4`}`;
    video.muted = false;
    video.volume = 1.0;
    videoPopup.classList.remove("hidden");

    video.onended = cleanup;
    video.onerror = cleanup;

    function cleanup() {
      video.pause();
      videoPopup.classList.add("hidden");
      updateChart(fullData);
      updateTopSellerUI(topSeller);
      resolve();
    }

    video.play();
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadPeopleData();
  await fetchGoals();
  fetchAndUpdate();
  pollingInterval = setInterval(fetchAndUpdate, 6000);
});
