import express from "express";
import cors from "cors";
import pkg from "body-parser";
import { existsSync, writeFileSync, readFileSync } from "fs";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";

import { keys } from "./.env/keys"

const { json } = pkg;
const openai = new OpenAI({
  apiKey: keys.openai,
});

const app = express();
const PORT = 3000;
const DATA_FILE = ".env/users.json";

const SYSTEM_PROMPT = `
  You are an assistant for me and your job is to pick the most suitable tasks from my list according to my needs. 
  Tasks will be provided in JSON format. Tasks have priorities, but don't pay too much attention to it. You have to reply with the message explaining your pick shortly, please don't repeat the request, don't use task numbers to describe the task, just reply as a human, in simple words, short one paragraph of text and also provide the picked tasks ids in the end, provide answer only in the following JSON format, no quotes, just object, no text outside the object:
  {
    "answerText": "TEXT OF YOUR RESPONSE, ONLY HERE",
    "pickedTasksArray": ["id1", "id2"]
  }`;

app.use(json());
app.use(cors());

// Initialize data file if it doesn't exist
if (!existsSync(DATA_FILE)) {
  writeFileSync(DATA_FILE, JSON.stringify([{}]), "utf8");
}

// Helper functions to read and write data with error handling
const readData = () => {
  try {
    const data = readFileSync(DATA_FILE, "utf8");
    return JSON.parse(data || "[{}]"); // Prevent parsing empty string
  } catch (error) {
    console.error("Error reading data file:", error);
    return [];
  }
};

const writeData = (data) => {
  try {
    const jsonData = JSON.stringify(data, null, 2);
    writeFileSync(DATA_FILE, jsonData, "utf8");
  } catch (error) {
    console.error("Error writing data file:", error);
  }
};

// Middleware to extract user ID from headers
const requireAuth = (req, res, next) => {
  req.userId = req.headers["user-id"];
  if (!req.userId) {
    return res.status(400).send("User ID header is missing");
  }
  next();
};

app.post("/auth/signin", _);

app.post("/admin/users", (req, res) => {
  const users = readData();
  const newUser = { ...req.body, id: uuidv4() };
  users.push(newUser);
  writeData(users);
  res.status(201).json(newUser);
});

app.get("/admin/settings", _);

app.get("/user/me", requireAuth, (req, res) => {
  const users = readData();
  const user = users.find((user) => user.id === req.userId);
  if (user) {
    res.json(user);
  } else {
    res.status(404).send("User not found");
  }
});

app.patch("/user/me", requireAuth, (req, res) => {
  const users = readData();
  const index = users.findIndex((u) => u.id === req.userId);
  if (index !== -1) {
    const updatedUser = { ...users[index], ...req.body };
    users[index] = updatedUser;
    writeData(users);
    res.json(updatedUser);
  } else {
    res.status(404).send("User not found");
  }
});

app.delete("/user/me", requireAuth, (req, res) => {
  const users = readData();
  const index = users.findIndex((u) => u.id === req.userId);
  if (index !== -1) {
    users.splice(index, 1);
    writeData(users);
    res.status(204).send();
  } else {
    res.status(404).send("User not found");
  }
});

app.get("/tasks", requireAuth, (req, res) => {
  const users = readData();
  const user = users.find((user) => user.id === req.userId);

  if (!user) {
    return res.status(404).send("User not found");
  }

  let tasks = user.tasks;

  // Filter by status
  const statusFilter = req.query.filter;
  if (statusFilter) {
    const filters = statusFilter.split(','); // Split the filter string into an array
    tasks = tasks.filter((t) => filters.includes(t.status)); // Filter tasks based on the array
  } else {
    tasks = tasks.filter((t) => t.status === 'created'); // Filter created by default
  }

  // Search in description
  const searchQuery = req.query.search;
  if (searchQuery) {
    tasks = tasks.filter((t) => t.description.toLowerCase().includes(searchQuery.toLowerCase()));
  }

  // Sort tasks
  const sortCriteria = req.query.sort;
  
  if (sortCriteria === "priorityAsc") {
    tasks.sort((a, b) => {
      const priorityOrder = ["sooner", "later", "maybe never"];
      return priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority);
    });
  } else if (sortCriteria === "priorityDesc") {
    tasks.sort((a, b) => {
      const priorityOrder = ["maybe never", "later", "sooner"];
      return priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority);
    });
  } else if (sortCriteria === "dateNewerFirst") {
    tasks.sort((a, b) => new Date(b.creationDate) - new Date(a.creationDate));
  } else if (sortCriteria === "dateOlderFirst") {
    tasks.sort((a, b) => new Date(a.creationDate) - new Date(b.creationDate));
  }

  res.json(tasks);
});

app.patch("/tasks/:id", requireAuth, (req, res) => {
  const users = readData();
  const user = users.find((u) => u.id === req.userId);

  if (user) {
    const tasks = user.tasks;
    const taskIndex = tasks.findIndex(
      (t) => t.taskId.toString() === req.params.id.toString()
    );
    delete req.body.taskId;
    if (taskIndex !== -1) {
      const updatedTask = { ...tasks[taskIndex], ...req.body };
      tasks[taskIndex] = updatedTask;
      writeData(users);
      res.json(updatedTask);
    } else {
      res.status(404).send("Task not found");
    }
  } else {
    res.status(404).send("User not found");
  }
});

app.delete("/tasks/:id", requireAuth, (req, res) => {
  const users = readData();
  const user = users.find((u) => u.id === req.userId);
  if (user) {
    const tasks = user.tasks;
    user.tasks = tasks.filter((t) => t.taskId !== req.params.id);
    writeData(users);
    res.status(204).send("Task deleted");
  } else {
    res.status(404).send("User not found");
  }
});

app.post("/tasks", requireAuth, (req, res) => {
  const users = readData();
  const user = users.find((u) => u.id === req.userId);
  if (user) {
    const tasks = user.tasks;
    const newTask = {
      taskId: uuidv4(),
      creationDate: new Date().toISOString(),
      status: "created",
      updateDate: "",
      ...req.body,
    };
    tasks.push(newTask);
    writeData(users);
    res.json(newTask);
  } else {
    res.status(404).send("Can't find user to add task to");
  }
});

app.get("/tasks/:id", requireAuth, (req, res) => {
  const users = readData();
  const user = users.find((user) => user.id === req.userId);

  if (user) {
    const taskId = req.params.id;
    const task = user.tasks.find((t) => t.taskId == taskId);

    if (task) {
      res.json(task);
    } else {
      res.status(404).send("Task not found or not in created status");
    }
  } else {
    res.status(404).send("User not found");
  }
});

app.post("/assistant", async (req, res) => {
  const userId = req.headers["user-id"];
  if (!userId) {
    return res.status(400).send("User ID header is missing");
  }

  const users = readData();
  const user = users.find((u) => u.id === userId);

  const unresolvedTasks = user.tasks.filter((t) => t.status === "created");

  if (!user) {
    return res.status(404).send("User not found");
  }

  const tasks = user.tasks;
  if (!tasks || tasks.length === 0) {
    return res.status(404).send("No tasks found for the user");
  }

  const prompt = req.body;

  try {
  //     const response = await openai.chat.completions.create({
  //       messages: [
  //         {role: "system", content: SYSTEM_PROMPT + ' Tasks we are working with: ' + JSON.stringify(unresolvedTasks) },
  //         ...req.body
  //       ],
  //       model: "gpt-4o",
  //     });

  //     const assistantAnswer = response.choices[0].message.content

  //     if (assistantAnswer) {
  //       res.json(assistantAnswer);
    if (true) {
      setTimeout(() => {
        res.json(
          `{"answerText": "here is text of an answer", "pickedTasksArray": ["1", "2", "3"]}`
        );
      }, 2000);
    } else {
      res.status(404).send("Could not find the task described by ChatGPT");
    }
  } catch (error) {
    console.error("Error communicating with OpenAI API:", error);
    res.status(500).send("Error communicating with OpenAI API");
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
