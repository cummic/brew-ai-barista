import { createClient } from "@supabase/supabase-js";

export interface DbLocation {
  id: string;
  name: string;
  address: string;
  status: string;
  hours: string;
}

export interface DbProduct {
  id: string;
  category: "drink" | "pastry";
  name: string;
  base_price: number;
}

export interface DbModifierGroup {
  id: string;
  name: string;
}

export interface DbModifier {
  id: string;
  modifier_group_id: string;
  name: string;
  upcharge: number;
}

export interface DbProductModifierGroup {
  product_id: string;
  modifier_group_id: string;
}

export interface MenuData {
  locations: DbLocation[];
  products: DbProduct[];
  modifierGroups: DbModifierGroup[];
  modifiers: DbModifier[];
  productModifierGroups: DbProductModifierGroup[];
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("[db] Supabase credentials not set");
  return createClient(url, key);
}

export async function loadMenuData(): Promise<MenuData> {
  const supabase = getSupabase();

  const [
    { data: locations, error: e1 },
    { data: products, error: e2 },
    { data: modifierGroups, error: e3 },
    { data: modifiers, error: e4 },
    { data: productModifierGroups, error: e5 },
  ] = await Promise.all([
    supabase.from("locations").select("*"),
    supabase.from("products").select("*"),
    supabase.from("modifier_groups").select("*"),
    supabase.from("modifiers").select("*"),
    supabase.from("product_modifier_groups").select("*"),
  ]);

  const errors = [e1, e2, e3, e4, e5].filter(Boolean);
  if (errors.length > 0) {
    throw new Error(`[db] Failed to load menu: ${errors.map((e) => e?.message).join("; ")}`);
  }

  return {
    locations: (locations ?? []) as DbLocation[],
    products: (products ?? []) as DbProduct[],
    modifierGroups: (modifierGroups ?? []) as DbModifierGroup[],
    modifiers: (modifiers ?? []) as DbModifier[],
    productModifierGroups: (productModifierGroups ?? []) as DbProductModifierGroup[],
  };
}

export interface StoreInfoResult {
  id: string;
  name: string;
  address: string;
  status: string;
  hours: string;
  inventory: {
    drinks: { id: string; name: string; base_price: number }[];
    milk_options: { id: string; name: string; upcharge: number }[];
    pastries: { id: string; name: string; price: number }[];
  };
}

export async function fetchStoreInfo(
  locationId: string,
  data: MenuData
): Promise<StoreInfoResult | null> {
  const location = data.locations.find((l) => l.id === locationId);
  if (!location) return null;

  const supabase = getSupabase();

  const { data: unavailableRows, error } = await supabase
    .from("location_inventory")
    .select("product_id")
    .eq("location_id", locationId)
    .eq("is_available", false);

  if (error) {
    console.warn(`[db] location_inventory query failed for ${locationId}:`, error.message);
  }

  const unavailableIds = new Set((unavailableRows ?? []).map((r: { product_id: string }) => r.product_id));

  const drinks = data.products.filter((p) => p.category === "drink" && !unavailableIds.has(p.id));
  const pastries = data.products.filter((p) => p.category === "pastry" && !unavailableIds.has(p.id));
  const milkModifiers = data.modifiers.filter((m) => m.modifier_group_id === "milk_options");

  return {
    id: location.id,
    name: location.name,
    address: location.address,
    status: location.status,
    hours: location.hours,
    inventory: {
      drinks: drinks.map((d) => ({ id: d.id, name: d.name, base_price: d.base_price })),
      milk_options: milkModifiers.map((m) => ({ id: m.id, name: m.name, upcharge: m.upcharge })),
      pastries: pastries.map((p) => ({ id: p.id, name: p.name, price: p.base_price })),
    },
  };
}

export interface InsertOrderResult {
  orderId: string;
}

export async function insertOrder(params: {
  sessionId: string;
  userName: string;
  locationId: string;
  drinkProductId: string;
  drinkTotalPrice: number;
  milkModifierId: string | null;
  pastryProductId: string | null;
  pastryTotalPrice: number;
  orderTotal: number;
}): Promise<InsertOrderResult> {
  const supabase = getSupabase();

  const environment = process.env.NODE_ENV === "production" ? "production" : "development";

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      session_id: params.sessionId,
      user_name: params.userName,
      location_id: params.locationId,
      total_price: params.orderTotal,
      status: "pending",
      environment,
    })
    .select("id")
    .single();

  if (orderError || !order) {
    throw new Error(`[db] Failed to insert order: ${orderError?.message}`);
  }

  const orderId = (order as { id: string }).id;

  const { data: drinkItem, error: drinkError } = await supabase
    .from("order_items")
    .insert({
      order_id: orderId,
      product_id: params.drinkProductId,
      total_price: params.drinkTotalPrice,
    })
    .select("id")
    .single();

  if (drinkError || !drinkItem) {
    throw new Error(`[db] Failed to insert drink item: ${drinkError?.message}`);
  }

  const drinkItemId = (drinkItem as { id: string }).id;

  if (params.milkModifierId) {
    const { error: milkError } = await supabase.from("order_item_modifiers").insert({
      order_item_id: drinkItemId,
      modifier_id: params.milkModifierId,
    });
    if (milkError) throw new Error(`[db] Failed to insert milk modifier: ${milkError.message}`);
  }

  if (params.pastryProductId) {
    const { error: pastryError } = await supabase.from("order_items").insert({
      order_id: orderId,
      product_id: params.pastryProductId,
      total_price: params.pastryTotalPrice,
    });
    if (pastryError) throw new Error(`[db] Failed to insert pastry item: ${pastryError.message}`);
  }

  return { orderId };
}
