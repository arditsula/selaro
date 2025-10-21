import { type User, type InsertUser, type CallLog, type InsertCallLog } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createCallLog(callLog: InsertCallLog): Promise<CallLog>;
  getAllCallLogs(): Promise<CallLog[]>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private callLogs: CallLog[];

  constructor() {
    this.users = new Map();
    this.callLogs = [];
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async createCallLog(insertCallLog: InsertCallLog): Promise<CallLog> {
    const callLog: CallLog = {
      id: randomUUID(),
      ...insertCallLog,
      status: "New",
      createdAt: new Date().toISOString(),
    };
    this.callLogs.unshift(callLog);
    return callLog;
  }

  async getAllCallLogs(): Promise<CallLog[]> {
    return this.callLogs;
  }
}

export const storage = new MemStorage();
