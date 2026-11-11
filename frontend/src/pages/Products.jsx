import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, formatBRL } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Scissors, PackagePlus, Image as ImageIcon, Link2, Search } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import useSubmitLock from "@/hooks/useSubmitLock";
import { getMountableQuantity, getMountableSizes } from "@/lib/mountableProducts";

const BLANK = { name: "", sku: "", category_id: "", subcategory_id: "", color: "", brand: "", shelf: "", cost: 0, price: 0, commission: 1, sizes: [], stock_min: 0, linked_ids: [], photo: "", photo_url: "" };

const productForEditing = (product) => {
  const copy = JSON.parse(JSON.stringify(product));
  return { ...copy, stock_min: copy.sizes?.[0]?.stock_min ?? 0 };
};

const Field = ({ label, children, wide }) => (
  <label className={`block ${wide ? "md:col-span-2" : ""}`}><div className="font-head text-[11px] text-neutral-600 mb-1">{label}</div>{children}</label>
);

const SizeChips = ({ sizes }) => (
  <div className="flex flex-wrap max-w-md">
    {(sizes || []).map((s) => {
      const low = Number(s.stock_min) > 0 && Number(s.stock) <= Number(s.stock_min);
      return <span key={s.size} className={`chip ${low ? "chip-low" : ""}`}>{s.size}: {s.stock}</span>;
    })}
  </div>
);

function ProductThumbnail({ product }) {
  const imageRef = React.useRef(null);
  const [uploadedPhoto, setUploadedPhoto] = useState("");

  useEffect(() => {
    if (product.photo_url) return undefined;
    if (!imageRef.current) return undefined;
    let active = true;
    const loadPhoto = async () => {
      try {
        const { data } = await api.get(`/products/${product.id}/photo`);
        if (active) setUploadedPhoto(data.photo);
      } catch (error) {
        if (active && error.response?.status !== 404) {
          console.error(`Não foi possível carregar a foto do produto ${product.id}.`, error);
        }
      }
    };

    if (!("IntersectionObserver" in window)) {
      loadPhoto();
      return () => { active = false; };
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        loadPhoto();
      }
    }, { rootMargin: "100px" });
    observer.observe(imageRef.current);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [product.id, product.photo_url]);

  const photo = product.photo_url || uploadedPhoto;
  return (
    <div ref={imageRef} className="w-11 h-11 rounded bg-[#E8E2D5] flex items-center justify-center overflow-hidden">
      {photo ? <img src={photo} alt={product.name} className="w-full h-full object-cover" /> : <ImageIcon size={18} className="text-neutral-500" />}
    </div>
  );
}

function LinkPicker({ editing, setEditing, products }) {
  const [q, setQ] = useState("");
  const ids = editing.linked_ids || [];
  const toggle = (id) => setEditing({ ...editing, linked_ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] });
  const options = products
    .filter((p) => p.id !== editing.id && (!q || (p.name + p.sku + (p.color || "")).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => ((b.color || "") === (editing.color || "")) - ((a.color || "") === (editing.color || "")));
  return (
    <div className="lm-card p-3" data-testid="link-picker">
      <div className="flex items-center gap-2 font-head text-sm"><Link2 size={15} color="#4B5320" /> Vínculo de desmontagem</div>
      <p className="text-xs text-neutral-600 mt-1 mb-2">
        Selecione os produtos em que este produto se desmonta (ex.: FARDA → CALÇA + GANDOLA da mesma cor). A desmontagem sempre usa o mesmo tamanho.
        Se um produto vinculado ficar sem estoque numa venda, 1 unidade deste produto é desmontada automaticamente.
      </p>
      <div className="relative mb-2"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input className="lm-input lm-search-input" placeholder="Buscar produto para vincular..." value={q} onChange={(e) => setQ(e.target.value)} data-testid="link-search" /></div>
      <div className="max-h-48 overflow-y-auto border rounded bg-white">
        {options.map((p) => (
          <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[#F4EFE3] cursor-pointer border-b last:border-0">
            <input type="checkbox" checked={ids.includes(p.id)} onChange={() => toggle(p.id)} data-testid={`link-opt-${p.sku}`} />
            <span className="font-semibold">{p.name}</span><span className="text-neutral-500 text-xs">{p.sku} · {p.color || "sem cor"}</span>
            {editing.color && p.color === editing.color && <span className="badge bg-[#E6EBD3] text-[#4B5320] ml-auto">mesma cor</span>}
          </label>
        ))}
        {options.length === 0 && <div className="p-3 text-xs text-neutral-500">Nenhum produto encontrado.</div>}
      </div>
    </div>
  );
}

function DesmontarDialog({ product, onClose, onDone, byId }) {
  const [size, setSize] = useState("");
  const [qty, setQty] = useState(1);
  const { run: withSubmitLock, isPending } = useSubmitLock();
  if (!product) return null;
  const run = () => withSubmitLock("submit", async () => {
    try {
      await api.post(`/products/${product.id}/desmontar`, { size, qty });
      toast.success("Desmontagem realizada"); onDone();
    } catch (e) { toast.error(e.response?.data?.detail || "Erro na desmontagem"); }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !isPending("submit") && onClose()}>
      <DialogContent data-testid="desmontar-dialog">
        <DialogHeader><DialogTitle className="font-head">Desmontar {product.name}</DialogTitle></DialogHeader>
        <div className="text-sm">Gera +1 de: <b>{product.linked_ids.map((id) => byId[id]?.name).filter(Boolean).join(" + ")}</b> por unidade.</div>
        <Field label="Tamanho">
          <select className="lm-input" value={size} onChange={(e) => setSize(e.target.value)} data-testid="desmontar-size">
            <option value="">—</option>
            {(product.sizes || []).map((s) => <option key={s.size} value={s.size}>{s.size} (estoque {s.stock})</option>)}
          </select>
        </Field>
        <Field label="Quantidade"><input type="number" min="1" className="lm-input" value={qty} onChange={(e) => setQty(Number(e.target.value))} data-testid="desmontar-qty" /></Field>
        <button className="lm-btn lm-btn-olive justify-center" disabled={!size || isPending("submit")} onClick={run} data-testid="desmontar-confirm">
          <Scissors size={15} />{isPending("submit") ? "Desmontando..." : "Desmontar"}
        </button>
      </DialogContent>
    </Dialog>
  );
}

function MontarDialog({ product, onClose, onDone, byId }) {
  const [size, setSize] = useState("");
  const [qty, setQty] = useState(1);
  const { run: withSubmitLock, isPending } = useSubmitLock();
  if (!product) return null;
  const components = product.linked_ids.map((id) => byId[id]).filter(Boolean);
  const selectedSize = product.sizes.find((item) => item.size === size);
  const canAssemble = Boolean(
    size
    && qty > 0
    && Number.isInteger(qty)
    && selectedSize
    && components.length === product.linked_ids.length
    && getMountableQuantity(product, size, byId) >= qty,
  );
  const run = () => withSubmitLock("submit", async () => {
    try {
      await api.post(`/products/${product.id}/montar`, { size, qty });
      toast.success("Montagem realizada");
      onDone();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Erro na montagem");
    }
  });
  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && !isPending("submit") && onClose()}>
      <DialogContent data-testid="montar-dialog">
        <DialogHeader><DialogTitle className="font-head">Montar {product.name}</DialogTitle></DialogHeader>
        <div className="text-sm">Consome por unidade: <b>{components.map((component) => component.name).join(" + ")}</b></div>
        <Field label="Tamanho">
          <select className="lm-input" value={size} onChange={(event) => setSize(event.target.value)} data-testid="montar-size">
            <option value="">—</option>
            {product.sizes.map((item) => <option key={item.size} value={item.size}>{item.size} (estoque do produto {item.stock})</option>)}
          </select>
        </Field>
        <div className="space-y-1 text-xs text-neutral-600">
          {components.map((component) => (
            <div key={component.id}>
              {component.name}: {Number(component.sizes.find((item) => item.size === size)?.stock || 0)} disponível(is)
            </div>
          ))}
        </div>
        <Field label="Quantidade"><input type="number" min="1" step="1" className="lm-input" value={qty} onChange={(event) => setQty(Number(event.target.value))} data-testid="montar-qty" /></Field>
        <button className="lm-btn lm-btn-olive justify-center" disabled={!canAssemble || isPending("submit")} onClick={run} data-testid="montar-confirm">
          <PackagePlus size={15} />{isPending("submit") ? "Montando..." : "Montar"}
        </button>
      </DialogContent>
    </Dialog>
  );
}

export default function Products() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [grids, setGrids] = useState([]);
  const [editing, setEditing] = useState(null);
  const [desmontar, setDesmontar] = useState(null);
  const [montar, setMontar] = useState(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [sortDirection, setSortDirection] = useState("asc");
  const [params, setParams] = useSearchParams();
  const { run: withSubmitLock, isPending } = useSubmitLock();

  const load = async () => {
    const [p, c, g] = await Promise.all([api.get("/products"), api.get("/categories"), api.get("/size_grids")]);
    setProducts(p.data); setCategories(c.data); setGrids(g.data);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const productId = params.get("edit");
    if (!productId) return undefined;
    let active = true;
    api.get(`/products/${productId}`).then(({ data }) => {
      if (active) setEditing(productForEditing(data));
    }).catch((error) => {
      if (active) toast.error(error.response?.data?.detail || "Não foi possível carregar o produto");
    });
    return () => { active = false; };
  }, [params]);

  const byId = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const showMountable = params.get("montaveis") === "1";
  const mountableProducts = products.filter((product) => getMountableSizes(product, byId).length > 0);
  const catName = (id) => categories.find((c) => c.id === id)?.name || "-";
  const parentsOf = (id) => products.filter((p) => (p.linked_ids || []).includes(id));
  const topCats = categories.filter((c) => !c.parent_id);
  const subCats = editing ? categories.filter((c) => c.parent_id && c.parent_id === editing.category_id) : [];
  const gridObj = editing && grids.find((g) => g.name === categories.find((c) => c.id === editing.category_id)?.size_grid);

  const save = () => withSubmitLock("save", async () => {
    if (!editing.name || !editing.sku) return toast.error("Nome e SKU obrigatórios");
    const { stock_min, ...product } = editing;
    product.sizes = (product.sizes || []).map((size) => ({ ...size, stock_min: Number(stock_min || 0) }));
    try {
      if (editing.id) await api.put(`/products/${editing.id}`, product);
      else await api.post("/products", product);
      toast.success("Produto salvo"); setEditing(null); load();
    } catch { toast.error("Erro ao salvar"); }
  });
  const openEdit = async (productId) => {
    try {
      const { data } = await api.get(`/products/${productId}`);
      setEditing(productForEditing(data));
    } catch (error) {
      toast.error(error.response?.data?.detail || "Não foi possível carregar o produto");
    }
  };
  const remove = async (id) => { if (!window.confirm("Excluir produto?")) return; await api.delete(`/products/${id}`); toast.success("Removido"); load(); };
  const onPhoto = (f) => { if (!f) return; const r = new FileReader(); r.onload = () => setEditing((e) => ({ ...e, photo: r.result, photo_url: "" })); r.readAsDataURL(f); };
  const setSize = (i, patch) => setEditing((e) => { const sz = [...e.sizes]; sz[i] = { ...sz[i], ...patch }; return { ...e, sizes: sz }; });
  const addSize = (size = "") => setEditing((e) => (e.sizes.some((s) => s.size === size && size) ? e : { ...e, sizes: [...e.sizes, { size, stock: 0, stock_min: Number(e.stock_min || 0) }] }));
  const toggleMountableFilter = () => {
    const nextParams = new URLSearchParams(params);
    if (showMountable) nextParams.delete("montaveis");
    else nextParams.set("montaveis", "1");
    setParams(nextParams);
  };

  const filtered = products.filter((p) => {
    const matchesCategory = !categoryFilter || p.category_id === categoryFilter || p.subcategory_id === categoryFilter;
    const matchesSearch = !search || (p.name + p.sku + catName(p.category_id) + catName(p.subcategory_id) + (p.color || "")).toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch && (!showMountable || getMountableSizes(p, byId).length > 0);
  }).sort((first, second) => {
    const totalStock = (product) => (product.sizes || []).reduce((sum, item) => sum + Number(item.stock || 0), 0);
    const firstValue = sortBy === "category" ? catName(first.category_id)
      : sortBy === "stock" ? totalStock(first)
        : first[sortBy] ?? "";
    const secondValue = sortBy === "category" ? catName(second.category_id)
      : sortBy === "stock" ? totalStock(second)
        : second[sortBy] ?? "";
    const result = typeof firstValue === "number" && typeof secondValue === "number"
      ? firstValue - secondValue
      : String(firstValue).localeCompare(String(secondValue), "pt-BR", { numeric: true, sensitivity: "base" });
    return sortDirection === "asc" ? result : -result;
  });

  return (
    <div data-testid="products-page">
      <div className="lm-page-head flex items-end justify-between gap-3 flex-wrap">
        <div><h1>Produtos</h1><p>{products.length} produtos cadastrados · grade militar e vínculos de montagem/desmontagem</p></div>
        <button className="lm-btn lm-btn-olive" onClick={() => setEditing({ ...BLANK })} data-testid="btn-new-product"><Plus size={16} />Novo produto</button>
      </div>
      <div className="grid grid-cols-1 gap-2 mb-3 sm:grid-cols-2 lg:grid-cols-[minmax(160px,1fr)_minmax(180px,1fr)_auto_auto]">
        <div className="relative min-w-0 sm:col-span-2 lg:col-span-4">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input placeholder="Buscar por nome, SKU, categoria, cor..." value={search} onChange={(e) => setSearch(e.target.value)} className="lm-input lm-search-input w-full" data-testid="search-products" />
        </div>
        <label className="min-w-0">
          <span className="sr-only">Filtrar produtos por categoria</span>
          <select className="lm-input w-full" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} data-testid="filter-products-category">
            <option value="">Todas as categorias</option>
            {categories.filter((category) => !category.parent_id).map((category) => (
              <React.Fragment key={category.id}>
                <option value={category.id}>{category.name}</option>
                {categories.filter((subCategory) => subCategory.parent_id === category.id).map((subCategory) => (
                  <option key={subCategory.id} value={subCategory.id}>— {subCategory.name}</option>
                ))}
              </React.Fragment>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className="sr-only">Classificar produtos por</span>
          <select className="lm-input w-full" value={sortBy} onChange={(event) => setSortBy(event.target.value)} data-testid="sort-products">
            <option value="name">Ordenar por nome</option>
            <option value="sku">Ordenar por SKU</option>
            <option value="category">Ordenar por categoria</option>
            <option value="stock">Ordenar por estoque</option>
            <option value="cost">Ordenar por custo</option>
            <option value="price">Ordenar por preço</option>
            <option value="commission">Ordenar por comissão</option>
            <option value="shelf">Ordenar por prateleira</option>
          </select>
        </label>
        <button
          type="button"
          className="lm-btn lm-btn-outline shrink-0 justify-center whitespace-nowrap"
          onClick={() => setSortDirection((direction) => direction === "asc" ? "desc" : "asc")}
          aria-label={sortDirection === "asc" ? "Ordem crescente" : "Ordem decrescente"}
          data-testid="sort-products-direction"
        >
          {sortDirection === "asc" ? "A → Z" : "Z → A"}
        </button>
        <button
          type="button"
          className={`lm-btn shrink-0 justify-center whitespace-nowrap ${showMountable ? "lm-btn-olive" : "lm-btn-outline"}`}
          onClick={toggleMountableFilter}
          data-testid="filter-mountable-products"
        >
          {showMountable ? "Mostrar todos os produtos" : `Montagens disponíveis (${mountableProducts.length})`}
        </button>
      </div>

      {showMountable && <p className="mb-3 text-sm text-neutral-600">Mostrando produtos que podem ser montados com o estoque atual dos componentes.</p>}
      <div className="lm-table-wrap overflow-x-auto">
        <table className="lm-table">
          <thead><tr><th></th><th>Produto</th><th>Categoria</th><th>Estoque por tamanho</th><th>Total</th><th>Custo</th><th>Venda</th><th>Comissão</th><th>Prat.</th><th></th></tr></thead>
          <tbody>
            {filtered.map((p) => {
              const parents = parentsOf(p.id);
              return (
                <tr key={p.id} data-testid={`product-row-${p.sku}`}>
                  <td className="w-14">
                    <ProductThumbnail product={p} />
                  </td>
                  <td>
                    <div className="font-head font-semibold text-[15px]">{p.name}</div>
                    <div className="text-xs text-neutral-500">{[p.sku, categories.find((c) => c.id === p.subcategory_id)?.name, p.color, p.brand].filter(Boolean).join(" · ")}</div>
                    {(p.linked_ids || []).length > 0 && <div className="text-[11px] text-[#4B5320] font-semibold mt-0.5">↳ Monta com: {p.linked_ids.map((id) => byId[id]?.name).filter(Boolean).join(" + ")}</div>}
                    {showMountable && <div className="text-[11px] text-[#4B5320] font-semibold mt-0.5" data-testid={`mount-availability-${p.sku}`}>
                      Disponível para montar: {getMountableSizes(p, byId).map(({ size, quantity }) => `${size} (até ${quantity})`).join(", ")}
                    </div>}
                    {parents.length > 0 && <div className="text-[11px] text-[#9c7209] font-semibold mt-0.5">↳ Vinculado a: {parents.map((x) => x.name).join(", ")}</div>}
                  </td>
                  <td>{catName(p.category_id)}</td>
                  <td><SizeChips sizes={p.sizes} /></td>
                  <td className="font-head font-bold text-base">{(p.sizes || []).reduce((s, x) => s + Number(x.stock || 0), 0)}</td>
                  <td className="whitespace-nowrap">{formatBRL(p.cost)}</td>
                  <td className="whitespace-nowrap">{formatBRL(p.price)}</td>
                  <td className="whitespace-nowrap">{formatBRL(p.commission ?? 1)}</td>
                  <td>{p.shelf}</td>
                  <td className="whitespace-nowrap">
                    {(p.linked_ids || []).length > 0 && <>
                      <button className="p-1.5 hover:bg-[#E8E2D5] rounded" title="Desmontar" onClick={() => setDesmontar(p)} data-testid={`desmontar-${p.sku}`}><Scissors size={16} /></button>
                      <button className="p-1.5 hover:bg-[#E8E2D5] rounded" title="Montar" onClick={() => setMontar(p)} data-testid={`montar-${p.sku}`}><PackagePlus size={16} /></button>
                    </>}
                    <button className="p-1.5 hover:bg-[#E8E2D5] rounded" onClick={() => openEdit(p.id)} data-testid={`edit-${p.sku}`}><Pencil size={16} /></button>
                    <button className="p-1.5 hover:bg-red-100 rounded" onClick={() => remove(p.id)} data-testid={`delete-${p.sku}`}><Trash2 size={16} /></button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={10} className="text-center text-neutral-500 py-8">{showMountable ? "Nenhum produto pode ser montado com o estoque atual." : "Nenhum produto cadastrado."}</td></tr>}
          </tbody>
        </table>
      </div>

      {desmontar && <DesmontarDialog product={desmontar} byId={byId} onClose={() => setDesmontar(null)} onDone={() => { setDesmontar(null); load(); }} />}
      {montar && <MontarDialog product={montar} byId={byId} onClose={() => setMontar(null)} onDone={() => { setMontar(null); load(); }} />}

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="w-full sm:max-w-3xl overflow-y-auto" style={{ background: "#FBF9F4" }}>
          <SheetHeader><SheetTitle className="font-head text-xl">{editing?.id ? "Editar produto" : "Novo produto"}</SheetTitle></SheetHeader>
          {editing && (
            <div className="space-y-4 mt-4">
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded bg-[#E8E2D5] flex items-center justify-center overflow-hidden">
                  {editing.photo_url || editing.photo ? <img src={editing.photo_url || editing.photo} alt="" className="w-full h-full object-cover" /> : <ImageIcon className="text-neutral-500" />}
                </div>
                <div className="flex flex-col items-start gap-2">
                  <label className="lm-btn lm-btn-outline cursor-pointer">
                    Enviar foto
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(event) => {
                        onPhoto(event.target.files?.[0]);
                        event.target.value = "";
                      }}
                      data-testid="p-photo"
                    />
                  </label>
                  {(editing.photo || editing.photo_url) && <button type="button" className="text-xs text-red-700 underline" onClick={() => setEditing({ ...editing, photo: "", photo_url: "" })} data-testid="p-remove-photo">Remover foto</button>}
                </div>
              </div>
              <Field label="Ou cole o link público da imagem">
                <input
                  type="url"
                  className="lm-input"
                  placeholder="https://exemplo.com/foto-do-produto.jpg"
                  value={editing.photo_url || ""}
                  onChange={(event) => setEditing({
                    ...editing,
                    photo_url: event.target.value,
                    ...(event.target.value ? { photo: "" } : {}),
                  })}
                  data-testid="p-photo-url"
                />
              </Field>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Nome *"><input className="lm-input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} data-testid="p-name" /></Field>
                <Field label="SKU *"><input className="lm-input" value={editing.sku} onChange={(e) => setEditing({ ...editing, sku: e.target.value })} data-testid="p-sku" /></Field>
                <Field label="Categoria">
                  <select className="lm-input" value={editing.category_id || ""} onChange={(e) => setEditing({ ...editing, category_id: e.target.value, subcategory_id: "" })} data-testid="p-category">
                    <option value="">—</option>{topCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
                <Field label="Subcategoria">
                  <select className="lm-input" value={editing.subcategory_id || ""} onChange={(e) => setEditing({ ...editing, subcategory_id: e.target.value })} data-testid="p-subcategory">
                    <option value="">—</option>{subCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
                <Field label="Cor"><input className="lm-input" value={editing.color || ""} onChange={(e) => setEditing({ ...editing, color: e.target.value })} data-testid="p-color" /></Field>
                <Field label="Marca"><input className="lm-input" value={editing.brand || ""} onChange={(e) => setEditing({ ...editing, brand: e.target.value })} data-testid="p-brand" /></Field>
                <Field label="Custo (R$)"><input type="number" step="0.01" className="lm-input" value={editing.cost} onChange={(e) => setEditing({ ...editing, cost: Number(e.target.value) })} data-testid="p-cost" /></Field>
                <Field label="Venda (R$)"><input type="number" step="0.01" className="lm-input" value={editing.price} onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })} data-testid="p-price" /></Field>
                <Field label="Comissão por unidade (R$)"><input type="number" min="0" step="0.01" className="lm-input" value={editing.commission ?? 1} onChange={(e) => setEditing({ ...editing, commission: Number(e.target.value) })} data-testid="p-commission" /></Field>
                <Field label="Prateleira"><input className="lm-input" value={editing.shelf || ""} onChange={(e) => setEditing({ ...editing, shelf: e.target.value })} data-testid="p-shelf" /></Field>
              </div>

              <div className="lm-card p-3">
                <div className="flex items-center justify-between">
                  <div className="font-head text-sm">Grade de tamanhos {gridObj && <span className="text-xs text-neutral-500">({gridObj.name})</span>}</div>
                  <button type="button" className="lm-btn lm-btn-outline !py-1 !px-2 !text-xs" onClick={() => addSize()} data-testid="p-add-size">+ Tamanho</button>
                </div>
                {gridObj && <div className="flex flex-wrap gap-1 my-2">{gridObj.sizes.map((s) => (
                  <button key={s} type="button" className="chip hover:bg-[#d8cfbc]" onClick={() => addSize(s)} data-testid={`p-grid-${s}`}>+ {s}</button>
                ))}</div>}
                <Field label="Estoque mínimo por variação">
                  <input type="number" min="0" className="lm-input" value={editing.stock_min ?? 0} onChange={(e) => setEditing({ ...editing, stock_min: Number(e.target.value) })} data-testid="p-min" />
                  <span className="text-xs text-neutral-500">Este mínimo será aplicado a cada tamanho do produto.</span>
                </Field>
                {editing.sizes.length > 0 && <div className="grid grid-cols-3 gap-2 mt-2 font-head text-[11px] text-neutral-600"><span>Tamanho</span><span>Estoque</span><span></span></div>}
                {editing.sizes.map((s, i) => (
                  <div key={i} className="grid grid-cols-3 gap-2 mt-1 items-center">
                    <input className="lm-input" value={s.size} onChange={(e) => setSize(i, { size: e.target.value })} data-testid={`p-size-${i}`} />
                    <input type="number" className="lm-input" value={s.stock} onChange={(e) => setSize(i, { stock: Number(e.target.value) })} data-testid={`p-stock-${i}`} />
                    <button type="button" className="text-red-700 text-xs" onClick={() => setEditing({ ...editing, sizes: editing.sizes.filter((_, x) => x !== i) })}>remover</button>
                  </div>
                ))}
              </div>

              <LinkPicker editing={editing} setEditing={setEditing} products={products} />

              <div className="flex gap-2 pt-2">
                <button className="lm-btn lm-btn-olive" onClick={save} disabled={isPending("save")} data-testid="save-product">
                  {isPending("save") ? "Salvando..." : "Salvar"}
                </button>
                <button className="lm-btn lm-btn-outline" onClick={() => setEditing(null)}>Cancelar</button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
