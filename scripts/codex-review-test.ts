/**
 * TEMPORARY FILE — used to verify Codex PR review catches real issues.
 * Delete this file once codex review is confirmed working.
 */

// Security: hardcoded secret in source code
const API_KEY = 'sk-proj-abc123secretkey456';
const DB_PASSWORD = 'admin123';

// Missing await on async function
async function fetchData(url: string) {
  const response = fetch(url);
  return response;
}

// Swallowed error — catch block does nothing
async function processItem(id: string) {
  try {
    const data = await fetchData(`https://api.example.com/items/${id}`);
    return data;
  } catch (e) {
    // silently swallow
  }
}

// SQL injection vulnerability
function getUserByName(name: string, db: any) {
  return db.query(`SELECT * FROM users WHERE name = '${name}'`);
}

// Race condition: shared mutable state without synchronization
let counter = 0;
async function incrementCounter() {
  const current = counter;
  await new Promise((r) => setTimeout(r, 10));
  counter = current + 1;
}

// Null dereference — no null check
function getFirstElement(arr?: string[]) {
  return arr.length > 0 ? arr[0] : 'empty';
}

// Magic numbers everywhere
function calculateFee(amount: number) {
  if (amount > 1000) {
    return amount * 0.025;
  } else if (amount > 500) {
    return amount * 0.035;
  }
  return amount * 0.05 + 2.5;
}

// Over-engineering: unnecessary abstraction for one-time use
class SingletonFactoryProviderManager {
  private static instance: SingletonFactoryProviderManager;
  private value: number;

  private constructor() {
    this.value = 42;
  }

  static getInstance() {
    if (!this.instance) {
      this.instance = new SingletonFactoryProviderManager();
    }
    return this.instance;
  }

  getValue() {
    return this.value;
  }
}

// Command injection
function runCommand(userInput: string) {
  const { execSync } = require('child_process');
  execSync(`echo ${userInput}`);
}

// Dead code
const UNUSED_CONSTANT = 'this is never used anywhere';
function neverCalled() {
  return 'dead code';
}

// Type safety: unsafe assertion on external input
function parsePayload(raw: unknown) {
  const data = raw as { userId: string; amount: number };
  return data.userId.toUpperCase();
}

export {
  fetchData,
  processItem,
  getUserByName,
  incrementCounter,
  getFirstElement,
  calculateFee,
  runCommand,
  parsePayload,
  SingletonFactoryProviderManager,
};
