/**
 * use-auth.ts  — Firebase Authentication hooks
 * ──────────────────────────────────────────────
 * Replaces the previous Supabase-based login/signup with
 * Firebase Auth (email + password).
 */
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  type UserCredential,
} from "firebase/auth";

export function useLogin() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  return useMutation<UserCredential, Error, { email: string; password: string }>({
    mutationFn: async ({ email, password }) => {
      return signInWithEmailAndPassword(auth, email, password);
    },
    onSuccess: () => {
      toast({
        title: "Login Successful",
        description: "Welcome to the NeuroGuard portal.",
      });
      setLocation("/");
    },
    onError: (error) => {
      toast({
        title: "Authentication Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useSignUp() {
  const { toast } = useToast();

  return useMutation<UserCredential, Error, { email: string; password: string }>({
    mutationFn: async ({ email, password }) => {
      return createUserWithEmailAndPassword(auth, email, password);
    },
    onSuccess: () => {
      toast({
        title: "Registration Successful",
        description: "Your account has been created. You can now sign in.",
      });
    },
    onError: (error) => {
      toast({
        title: "Registration Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
