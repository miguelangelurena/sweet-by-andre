
import Stripe from "stripe";
import { stripeSecret } from "./hosting.js";

export const stripe = new Stripe(stripeSecret());
