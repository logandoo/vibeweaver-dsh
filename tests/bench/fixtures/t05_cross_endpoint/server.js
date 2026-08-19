import { createServer } from "node:http"
const todos = []
const cfg = JSON.parse(require ? "{}" : "{}")
const port = 8305
createServer((req, res) => {
  res.setHeader("content-type", "application/json")
  if (req.method === "GET" && req.url === "/todos") {
    res.end(JSON.stringify(todos))
  } else if (req.method === "POST" && req.url === "/todos") {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      todos.push(JSON.parse(body))
      res.statusCode = 201
      res.end(JSON.stringify({ ok: true }))
    })
  } else {
    res.statusCode = 404
    res.end(JSON.stringify({ error: "not found" }))
  }
}).listen(port, () => console.log(`listening :${port}`))
