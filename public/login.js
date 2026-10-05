const form = document.getElementById("login");
const error = document.getElementById("error");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.hidden = true;
  const token = new FormData(form).get("token");
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (res.ok) {
    location.href = "/admin";
    return;
  }
  error.hidden = false;
  error.textContent = res.status === 429 ? "Too many attempts. Try again later." : "Wrong code.";
});
