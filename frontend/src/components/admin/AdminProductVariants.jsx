import { useCallback, useEffect, useState } from "react";

import {
  getAdminProductOptions,
  getAdminProductVariants,
  createProductOption,
  createProductOptionValue,
  createProductVariant,
  updateProductVariant,
  updateProductOption,
  updateProductOptionValue,
} from "../../services/api";

export default function AdminProductVariants({ productId }) {
  const [options, setOptions] = useState([]);
  const [variants, setVariants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [newOptionName, setNewOptionName] = useState("");
  const [newValues, setNewValues] = useState({});
  const [editingOptionId, setEditingOptionId] = useState(null);
  const [optionNameDraft, setOptionNameDraft] = useState("");
  const [editingValueId, setEditingValueId] = useState(null);
  const [valueDraft, setValueDraft] = useState("");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadOptions = useCallback(async () => {
    const response = await getAdminProductOptions(productId);
    setOptions(response.options ?? []);
  }, [productId]);

  const [editingVariantId, setEditingVariantId] = useState(null);

  const [variantForm, setVariantForm] = useState({
    price: "",
    stock: "",
    is_available: true,
  });

  const [newVariant, setNewVariant] = useState({
    price: "",
    stock: "0",
    is_available: true,
    selectedValues: {},
  });

  useEffect(() => {
    let active = true;

    async function initialize() {
      setLoading(true);
      setError("");
      setOptions([]);
      setVariants([]);
      setEditingVariantId(null);
      setNewVariant({
        price: "",
        stock: "0",
        is_available: true,
        selectedValues: {},
      });

      try {
        const [optionsResponse, variantsResponse] = await Promise.all([
          getAdminProductOptions(productId),
          getAdminProductVariants(productId),
        ]);

        if (active) {
          setOptions(optionsResponse.options ?? []);
          setVariants(variantsResponse.variants ?? []);
        }
      } catch (err) {
        if (active) {
          setError(err.message || "Could not load product options.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    initialize();

    return () => {
      active = false;
    };
  }, [productId]);

  async function handleCreateOption(event) {
    event.preventDefault();

    const name = newOptionName.trim();

    if (!name || saving) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      await createProductOption(productId, name);
      setNewOptionName("");

      await loadOptions();

      setSuccess("Product option created successfully.");
    } catch (err) {
      setError(err.message || "Could not create product option.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateValue(event, optionId) {
    event.preventDefault();

    const value = (newValues[optionId] ?? "").trim();

    if (!value || saving) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      await createProductOptionValue(optionId, value);

      setNewValues((previous) => ({
        ...previous,
        [optionId]: "",
      }));

      await loadOptions();

      setSuccess("Option value added successfully.");
    } catch (err) {
      setError(err.message || "Could not add option value.");
    } finally {
      setSaving(false);
    }
  }

  function beginEditOption(option) {
    setEditingOptionId(option.id);
    setOptionNameDraft(option.name);
    setEditingValueId(null);
    setError("");
    setSuccess("");
  }

  async function saveOptionName(event, optionId) {
    event.preventDefault();
    const name = optionNameDraft.trim();
    if (saving) return;
    if (!name) {
      setError("Option name cannot be empty.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await updateProductOption(optionId, { name });
      await loadOptions();
      setEditingOptionId(null);
      setSuccess("Option name updated successfully.");
    } catch (err) {
      setError(err.message || "Could not update option name.");
    } finally {
      setSaving(false);
    }
  }

  function beginEditValue(value) {
    setEditingValueId(value.id);
    setValueDraft(value.value);
    setEditingOptionId(null);
    setError("");
    setSuccess("");
  }

  async function saveValueName(event, valueId) {
    event.preventDefault();
    const value = valueDraft.trim();
    if (saving) return;
    if (!value) {
      setError("Value cannot be empty.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await updateProductOptionValue(valueId, { value });
      await loadOptions();
      const response = await getAdminProductVariants(productId);
      setVariants(response.variants ?? []);
      setEditingValueId(null);
      setSuccess("Option value updated successfully.");
    } catch (err) {
      setError(err.message || "Could not update option value.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleValue(value) {
    if (saving) return;
    const nextActive = !value.is_active;
    if (!nextActive) {
      const affected = variants.filter(
        (variant) =>
          variant.is_available &&
          variant.options.some((selected) => selected.value_id === value.id),
      ).length;
      const message = affected
        ? `Deactivate "${value.value}"? ${affected} available variant(s) using this value will no longer be shown to customers. Existing variants will not be deleted.`
        : `Deactivate "${value.value}"? Existing variants will not be deleted.`;
      if (!window.confirm(message)) return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await updateProductOptionValue(value.id, { is_active: nextActive });
      await loadOptions();
      setSuccess(nextActive ? "Value activated." : "Value deactivated.");
    } catch (err) {
      setError(err.message || "Could not change value availability.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-xl border border-[#E7DCD9] bg-white px-4 py-3 " +
    "text-sm text-[#282323] outline-none transition-colors " +
    "focus:border-[#D47783] focus:ring-2 focus:ring-[#D47783]/15";

  function handleEditVariant(variant) {
    setEditingVariantId(variant.id);

    setVariantForm({
      price: String(variant.price),
      stock: String(variant.stock),
      is_available: variant.is_available,
    });

    setError("");
    setSuccess("");
  }

  function handleCancelVariantEdit() {
    setEditingVariantId(null);
  }

  async function handleSaveVariant(variantId) {
    if (saving) return;

    const price = Number(variantForm.price);
    const stock = Number(variantForm.stock);

    if (
      variantForm.price.trim() === "" ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      setError("Enter a valid price greater than zero.");
      return;
    }

    if (
      variantForm.stock.trim() === "" ||
      !Number.isInteger(stock) ||
      stock < 0
    ) {
      setError("Stock must be a non-negative integer.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      await updateProductVariant(variantId, {
        price,
        stock,
        is_available: variantForm.is_available,
      });

      const response = await getAdminProductVariants(productId);

      setVariants(response.variants ?? []);
      setEditingVariantId(null);

      setSuccess("Variant updated successfully.");
    } catch (err) {
      setError(err.message || "Could not update variant.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateVariant(event) {
    event.preventDefault();

    if (saving) return;

    setError("");
    setSuccess("");

    const price = Number(newVariant.price);
    const stock = Number(newVariant.stock);

    if (
      newVariant.price.trim() === "" ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      setError("Enter a valid price greater than zero.");
      return;
    }

    if (
      newVariant.stock.trim() === "" ||
      !Number.isInteger(stock) ||
      stock < 0
    ) {
      setError("Stock must be a non-negative integer.");
      return;
    }

    // Every configured option must have a selected active value.
    const selectedOptions = [];

    for (const option of options) {
      const valueId = newVariant.selectedValues[option.id];

      const selectedValue = (option.values ?? []).find(
        (value) => value.id === valueId && value.is_active,
      );

      if (!selectedValue) {
        setError(`Select a valid value for ${option.name}.`);
        return;
      }

      selectedOptions.push({
        option_id: option.id,
        value_id: valueId,
      });
    }

    // Prevent duplicate combinations in the UI.
    const alreadyExists = variants.some((variant) => {
      if (variant.options.length !== selectedOptions.length) {
        return false;
      }

      return selectedOptions.every((selected) =>
        variant.options.some(
          (existing) =>
            existing.option_id === selected.option_id &&
            existing.value_id === selected.value_id,
        ),
      );
    });

    if (alreadyExists) {
      setError("This product variant already exists.");
      return;
    }

    setSaving(true);

    try {
      await createProductVariant(productId, {
        price,
        stock,
        is_available: newVariant.is_available,
        options: selectedOptions,
      });

      const response = await getAdminProductVariants(productId);

      setVariants(response.variants ?? []);

      setNewVariant({
        price: "",
        stock: "0",
        is_available: true,
        selectedValues: {},
      });

      setSuccess("Product variant created successfully.");
    } catch (err) {
      setError(err.message || "Could not create product variant.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-[#E7DCD9] bg-white shadow-sm">
      <div className="border-b border-[#F0E7E5] bg-[#FAF7F5] px-5 py-6">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#B76473]">
          Product Configuration
        </p>

        <h2 className="font-serif text-2xl text-[#282323]">Product Options</h2>

        <p className="mt-2 text-sm text-[#756B69]">
          Configure sizes, flavors, and package options available for this
          product.
        </p>
      </div>

      <div className="space-y-6 p-5">
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        {success && (
          <p
            role="status"
            className="rounded-xl border border-green-100 bg-green-50 p-4 text-sm text-green-700"
          >
            {success}
          </p>
        )}

        {loading ? (
          <p className="text-sm text-[#756B69]">Loading product options...</p>
        ) : (
          <>
            {options.length === 0 ? (
              <p className="rounded-xl bg-[#FAF7F5] p-5 text-sm text-[#756B69]">
                No options configured yet. Create an option such as Size or
                Flavor.
              </p>
            ) : (
              <div className="space-y-5">
                {options.map((option) => (
                  <div
                    key={option.id}
                    className="rounded-xl border border-[#E7DCD9] p-5"
                  >
                    {editingOptionId === option.id ? (
                      <form
                        onSubmit={(event) => saveOptionName(event, option.id)}
                        className="flex flex-wrap gap-2"
                      >
                        <input
                          aria-label="Option name"
                          className={`${inputClass} flex-1`}
                          value={optionNameDraft}
                          onChange={(event) =>
                            setOptionNameDraft(event.target.value)
                          }
                          disabled={saving}
                          maxLength={150}
                          required
                        />
                        <button
                          type="submit"
                          disabled={saving}
                          className="rounded-lg bg-[#D47783] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => setEditingOptionId(null)}
                          className="rounded-lg border border-[#E7DCD9] px-3 py-2 text-sm"
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="text-lg font-semibold text-[#282323]">
                          {option.name}
                        </h3>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => beginEditOption(option)}
                          className="rounded-lg border border-[#E7DCD9] px-3 py-2 text-sm text-[#B76473] disabled:opacity-50"
                        >
                          Rename option
                        </button>
                      </div>
                    )}

                    <div className="mt-4 space-y-2">
                      {(option.values ?? []).length === 0 && (
                        <p className="text-sm text-[#756B69]">No values yet.</p>
                      )}
                      {(option.values ?? []).map((value) => (
                        <div
                          key={value.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#F0E7E5] bg-[#FAF7F5] p-3"
                        >
                          {editingValueId === value.id ? (
                            <form
                              onSubmit={(event) =>
                                saveValueName(event, value.id)
                              }
                              className="flex min-w-0 flex-1 flex-wrap gap-2"
                            >
                              <input
                                aria-label="Value name"
                                className={`${inputClass} min-w-[140px] flex-1`}
                                value={valueDraft}
                                onChange={(event) =>
                                  setValueDraft(event.target.value)
                                }
                                disabled={saving}
                                maxLength={150}
                                required
                              />
                              <button
                                type="submit"
                                disabled={saving}
                                className="rounded-lg bg-[#D47783] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => setEditingValueId(null)}
                                className="rounded-lg border border-[#E7DCD9] px-3 py-2 text-sm"
                              >
                                Cancel
                              </button>
                            </form>
                          ) : (
                            <>
                              <span
                                className={
                                  value.is_active
                                    ? "text-sm font-medium text-[#453B39]"
                                    : "text-sm text-gray-400 line-through"
                                }
                              >
                                {value.value}
                              </span>
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => beginEditValue(value)}
                                  className="rounded-lg border border-[#E7DCD9] px-3 py-2 text-xs font-semibold text-[#B76473] disabled:opacity-50"
                                >
                                  Rename
                                </button>
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => toggleValue(value)}
                                  className={
                                    value.is_active
                                      ? "rounded-lg border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-800 disabled:opacity-50"
                                      : "rounded-lg border border-green-200 px-3 py-2 text-xs font-semibold text-green-700 disabled:opacity-50"
                                  }
                                >
                                  {value.is_active ? "Deactivate" : "Activate"}
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>

                    <form
                      onSubmit={(event) => handleCreateValue(event, option.id)}
                      className="mt-5 flex flex-col gap-3 sm:flex-row"
                    >
                      <input
                        type="text"
                        value={newValues[option.id] ?? ""}
                        onChange={(event) =>
                          setNewValues((previous) => ({
                            ...previous,
                            [option.id]: event.target.value,
                          }))
                        }
                        placeholder={`Add value to ${option.name}`}
                        className={inputClass}
                        disabled={saving}
                        required
                      />

                      <button
                        type="submit"
                        disabled={saving}
                        className="rounded-xl bg-[#D47783] px-5 py-3 text-sm font-semibold text-white hover:bg-[#B76473] disabled:opacity-50"
                      >
                        Add Value
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            )}

            <form
              onSubmit={handleCreateOption}
              className="rounded-xl border border-dashed border-[#DCC9C5] bg-[#FAF7F5] p-5"
            >
              <h3 className="mb-3 font-semibold text-[#282323]">
                Add New Option
              </h3>

              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  type="text"
                  value={newOptionName}
                  onChange={(event) => setNewOptionName(event.target.value)}
                  placeholder="e.g. Size, Flavor, Package Size"
                  className={inputClass}
                  disabled={saving}
                  required
                />

                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-[#D47783] px-5 py-3 text-sm font-semibold text-white hover:bg-[#B76473] disabled:opacity-50"
                >
                  Add Option
                </button>
              </div>
            </form>
            <div className="border-t border-[#F0E7E5] pt-8">
              <div className="mb-5">
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#B76473]">
                  Pricing & Inventory
                </p>

                <h3 className="font-serif text-2xl text-[#282323]">
                  Product Variants
                </h3>

                <p className="mt-2 text-sm text-[#756B69]">
                  Manage the price, stock, and availability of each product
                  configuration.
                </p>
              </div>

              {variants.length === 0 ? (
                <p className="rounded-xl bg-[#FAF7F5] p-5 text-sm text-[#756B69]">
                  No variants configured yet.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-[#E7DCD9]">
                  <table className="w-full min-w-[800px] text-left text-sm">
                    <thead className="bg-[#FAF7F5] text-[#756B69]">
                      <tr>
                        <th className="px-4 py-3 font-semibold">
                          Configuration
                        </th>
                        <th className="px-4 py-3 font-semibold">Price</th>
                        <th className="px-4 py-3 font-semibold">Stock</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 font-semibold">Actions</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-[#F0E7E5]">
                      {variants.map((variant) => {
                        const isEditing = editingVariantId === variant.id;

                        return (
                          <tr key={variant.id}>
                            <td className="px-4 py-4 text-[#282323]">
                              {variant.options.length === 0 ? (
                                <span className="italic text-[#8A807D]">
                                  Default / Legacy
                                </span>
                              ) : (
                                <div className="space-y-1">
                                  {variant.options.map((option) => (
                                    <p key={option.option_id}>
                                      <span className="font-semibold">
                                        {option.option_name}:
                                      </span>{" "}
                                      {option.value}
                                    </p>
                                  ))}
                                </div>
                              )}
                            </td>

                            <td className="px-4 py-4">
                              {isEditing ? (
                                <input
                                  type="number"
                                  min="0.01"
                                  step="0.01"
                                  value={variantForm.price}
                                  onChange={(event) =>
                                    setVariantForm((previous) => ({
                                      ...previous,
                                      price: event.target.value,
                                    }))
                                  }
                                  disabled={saving}
                                  aria-label="Variant price"
                                  className="w-28 rounded-lg border border-[#E7DCD9] px-3 py-2"
                                />
                              ) : (
                                <span className="font-semibold text-[#282323]">
                                  ${Number(variant.price).toFixed(2)}
                                </span>
                              )}
                            </td>

                            <td className="px-4 py-4">
                              {isEditing ? (
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={variantForm.stock}
                                  onChange={(event) =>
                                    setVariantForm((previous) => ({
                                      ...previous,
                                      stock: event.target.value,
                                    }))
                                  }
                                  disabled={saving}
                                  aria-label="Variant stock"
                                  className="w-24 rounded-lg border border-[#E7DCD9] px-3 py-2"
                                />
                              ) : (
                                <span className="text-[#756B69]">
                                  {variant.stock}
                                </span>
                              )}
                            </td>

                            <td className="px-4 py-4">
                              {isEditing ? (
                                <label className="flex items-center gap-2 text-[#453B39]">
                                  <input
                                    type="checkbox"
                                    checked={variantForm.is_available}
                                    onChange={(event) =>
                                      setVariantForm((previous) => ({
                                        ...previous,
                                        is_available: event.target.checked,
                                      }))
                                    }
                                    disabled={saving}
                                  />
                                  Available
                                </label>
                              ) : (
                                <span
                                  className={
                                    variant.is_available
                                      ? "rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700"
                                      : "rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-500"
                                  }
                                >
                                  {variant.is_available
                                    ? "Available"
                                    : "Unavailable"}
                                </span>
                              )}
                            </td>

                            <td className="px-4 py-4">
                              {isEditing ? (
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleSaveVariant(variant.id)
                                    }
                                    disabled={saving}
                                    className="rounded-lg bg-[#D47783] px-3 py-2 font-semibold text-white hover:bg-[#B76473] disabled:opacity-50"
                                  >
                                    {saving ? "Saving..." : "Save"}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={handleCancelVariantEdit}
                                    disabled={saving}
                                    className="rounded-lg border border-[#E7DCD9] px-3 py-2 text-[#756B69] hover:bg-[#FAF7F5]"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleEditVariant(variant)}
                                  disabled={saving}
                                  className="rounded-lg border border-[#D47783] px-4 py-2 font-semibold text-[#B76473] hover:bg-[#F7EEEE] disabled:opacity-50"
                                >
                                  Edit
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="mt-8 rounded-xl border border-[#E7DCD9] bg-[#FAF7F5] p-5 sm:p-6">
                <h4 className="font-serif text-xl text-[#282323]">
                  Create New Variant
                </h4>
                <p className="mt-2 text-sm text-[#756B69]">
                  Select the configuration, price, and inventory for this
                  variant.
                </p>

                <form onSubmit={handleCreateVariant} className="mt-6 space-y-5">
                  {options.length === 0 ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                      Create a product option and add its values first.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                      {options.map((option) => {
                        const activeValues = (option.values ?? []).filter(
                          (value) => value.is_active,
                        );

                        return (
                          <div key={option.id}>
                            <label
                              htmlFor={`variant-option-${option.id}`}
                              className="mb-2 block text-sm font-semibold text-[#453B39]"
                            >
                              {option.name}
                            </label>
                            <select
                              id={`variant-option-${option.id}`}
                              value={newVariant.selectedValues[option.id] ?? ""}
                              onChange={(event) =>
                                setNewVariant((previous) => ({
                                  ...previous,
                                  selectedValues: {
                                    ...previous.selectedValues,
                                    [option.id]: event.target.value,
                                  },
                                }))
                              }
                              disabled={saving || activeValues.length === 0}
                              required
                              className={inputClass}
                            >
                              <option value="">
                                {activeValues.length === 0
                                  ? "No active values available"
                                  : `Select ${option.name}`}
                              </option>
                              {activeValues.map((value) => (
                                <option key={value.id} value={value.id}>
                                  {value.value}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    <div>
                      <label
                        htmlFor="new-variant-price"
                        className="mb-2 block text-sm font-semibold text-[#453B39]"
                      >
                        Price (USD)
                      </label>
                      <input
                        id="new-variant-price"
                        type="number"
                        min="0.01"
                        step="0.01"
                        inputMode="decimal"
                        value={newVariant.price}
                        onChange={(event) =>
                          setNewVariant((previous) => ({
                            ...previous,
                            price: event.target.value,
                          }))
                        }
                        disabled={saving}
                        required
                        placeholder="18.00"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="new-variant-stock"
                        className="mb-2 block text-sm font-semibold text-[#453B39]"
                      >
                        Stock
                      </label>
                      <input
                        id="new-variant-stock"
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        value={newVariant.stock}
                        onChange={(event) =>
                          setNewVariant((previous) => ({
                            ...previous,
                            stock: event.target.value,
                          }))
                        }
                        disabled={saving}
                        required
                        className={inputClass}
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-3 text-sm font-medium text-[#453B39]">
                    <input
                      type="checkbox"
                      checked={newVariant.is_available}
                      onChange={(event) =>
                        setNewVariant((previous) => ({
                          ...previous,
                          is_available: event.target.checked,
                        }))
                      }
                      disabled={saving}
                      className="h-4 w-4 accent-[#D47783]"
                    />
                    Available for purchase
                  </label>

                  <div className="flex justify-end border-t border-[#E7DCD9] pt-5">
                    <button
                      type="submit"
                      disabled={
                        saving ||
                        options.length === 0 ||
                        options.some(
                          (option) =>
                            !(option.values ?? []).some(
                              (value) => value.is_active,
                            ),
                        )
                      }
                      className="w-full rounded-xl bg-[#D47783] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#B76473] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                    >
                      {saving ? "Creating..." : "Create Variant"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
