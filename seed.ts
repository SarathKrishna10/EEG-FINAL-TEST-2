import { storage } from "./server/storage";

async function seed() {
  console.log("Seeding database...");
  
  const users = [
    { email: "doctor@hospital.com", password: "password123" }
  ];

  const patients = [
    { email: "john.doe@example.com", name: "John Doe", previousDiagnosis: "Healthy", lastTestDate: new Date("2023-10-15T00:00:00Z") },
    { email: "jane.smith@example.com", name: "Jane Smith", previousDiagnosis: "Elevated heart rate", lastTestDate: new Date("2023-11-20T00:00:00Z") }
  ];

  for (const user of users) {
    const existing = await storage.getUserByEmail(user.email);
    if (!existing) {
      await storage.createUser(user);
      console.log(`Created user: ${user.email}`);
    }
  }

  for (const patient of patients) {
    const existing = await storage.getPatientByEmail(patient.email);
    if (!existing) {
      await storage.createPatient({
        ...patient,
        previousDiagnosis: patient.previousDiagnosis,
        lastTestDate: patient.lastTestDate
      });
      console.log(`Created patient: ${patient.email}`);
    }
  }
  
  console.log("Database seeded successfully!");
}

seed().catch(console.error);