import { db } from "./db";
import { users, patients, type InsertUser, type User, type Patient, type InsertPatient } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface IStorage {
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getPatientByEmail(email: string): Promise<Patient | undefined>;
  createPatient(patient: InsertPatient): Promise<Patient>;
}

export class DatabaseStorage implements IStorage {
  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getPatientByEmail(email: string): Promise<Patient | undefined> {
    const [patient] = await db.select().from(patients).where(eq(patients.email, email));
    return patient;
  }

  async createPatient(insertPatient: InsertPatient): Promise<Patient> {
    const [patient] = await db.insert(patients).values(insertPatient).returning();
    return patient;
  }
}

export class MemStorage implements IStorage {
  private users: Map<string, User> = new Map();
  private patients: Map<string, Patient> = new Map();
  private nextUserId = 1;
  private nextPatientId = 1;

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find((u) => u.email === email);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const user: User = { ...insertUser, id: this.nextUserId++ };
    this.users.set(String(user.id), user);
    return user;
  }

  async getPatientByEmail(email: string): Promise<Patient | undefined> {
    return Array.from(this.patients.values()).find((p) => p.email === email);
  }

  async createPatient(insertPatient: InsertPatient): Promise<Patient> {
    const patient: Patient = { 
      ...insertPatient, 
      id: this.nextPatientId++,
      previousDiagnosis: insertPatient.previousDiagnosis ?? null,
      lastTestDate: insertPatient.lastTestDate ?? null
    };
    this.patients.set(String(patient.id), patient);
    return patient;
  }
}

// Fallback to MemStorage if DATABASE_URL is missing or broken
export const storage = process.env.DATABASE_URL ? new DatabaseStorage() : new MemStorage();
