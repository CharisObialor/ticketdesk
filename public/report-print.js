// The "Print or save as PDF" button on shared ticket transcripts (/api/share/transcript/:token).
document.addEventListener("click", function (e) {
  if (e.target && e.target.closest && e.target.closest("[data-print]")) window.print();
});
