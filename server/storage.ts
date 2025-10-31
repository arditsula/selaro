import { type User, type InsertUser, type CallLog, type InsertCallLog, type Appointment, type InsertAppointment, type UpdateAppointment } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createCallLog(callLog: InsertCallLog): Promise<CallLog>;
  getAllCallLogs(): Promise<CallLog[]>;
  createAppointment(appointment: InsertAppointment): Promise<Appointment>;
  getAllAppointments(): Promise<Appointment[]>;
  getAppointment(id: string): Promise<Appointment | undefined>;
  updateAppointment(id: string, update: UpdateAppointment): Promise<Appointment | undefined>;
  deleteAppointment(id: string): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private callLogs: CallLog[];
  private appointments: Appointment[];

  constructor() {
    this.users = new Map();
    this.callLogs = [];
    this.appointments = [];
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

  async createAppointment(insertAppointment: InsertAppointment): Promise<Appointment> {
    const appointment: Appointment = {
      id: randomUUID(),
      ...insertAppointment,
      status: "Pending",
      createdAt: new Date().toISOString(),
    };
    this.appointments.push(appointment);
    return appointment;
  }

  async getAllAppointments(): Promise<Appointment[]> {
    return this.appointments.sort((a, b) => {
      const dateA = new Date(a.datetime).getTime();
      const dateB = new Date(b.datetime).getTime();
      return dateB - dateA;
    });
  }

  async getAppointment(id: string): Promise<Appointment | undefined> {
    return this.appointments.find(apt => apt.id === id);
  }

  async updateAppointment(id: string, update: UpdateAppointment): Promise<Appointment | undefined> {
    const index = this.appointments.findIndex(apt => apt.id === id);
    if (index === -1) return undefined;
    
    this.appointments[index] = {
      ...this.appointments[index],
      ...update,
    };
    return this.appointments[index];
  }

  async deleteAppointment(id: string): Promise<boolean> {
    const index = this.appointments.findIndex(apt => apt.id === id);
    if (index === -1) return false;
    
    this.appointments.splice(index, 1);
    return true;
  }
}

export const storage = new MemStorage();
