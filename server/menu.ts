import { readFileSync } from "fs";
import { join } from "path";

export interface DrinkItem {
  id: string;
  name: string;
  base_price: number;
}

export interface MilkOption {
  id: string;
  name: string;
  upcharge: number;
}

export interface PastryItem {
  id: string;
  name: string;
  price: number;
}

export interface LocationItem {
  id: string;
  name: string;
  address: string;
  status: string;
  hours: string;
}

export interface Menu {
  drinks: DrinkItem[];
  milk_options: MilkOption[];
  pastries: PastryItem[];
  tip_options: number[];
  tax_rate: number;
  locations: LocationItem[];
}

function loadMenu(): Menu {
  const path = join(process.cwd(), "menu.json");
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as Menu;
}

export const menu = loadMenu();

export function getDrink(id: string): DrinkItem | undefined {
  return menu.drinks.find((d) => d.id === id);
}

export function getMilkOption(id: string): MilkOption | undefined {
  return menu.milk_options.find((m) => m.id === id);
}

export function getPastry(id: string): PastryItem | undefined {
  return menu.pastries.find((p) => p.id === id);
}

export function getLocation(id: string): LocationItem | undefined {
  return menu.locations.find((l) => l.id === id);
}
