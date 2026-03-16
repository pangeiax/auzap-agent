// import React, { useState, useCallback, useMemo } from "react";
// import { Loader2, Plus, Edit2, Trash2 } from "lucide-react";
// import { Button } from "@/components/atoms/Button";
// import { Input } from "@/components/atoms/Input";
// import { TextArea } from "@/components/atoms/TextArea";
// import { Modal } from "@/components/molecules/Modal";
// import { useSettings } from "@/hooks/useSettings";
// import { useToast } from "@/hooks";
// import type { Service } from "@/types";

// type FormDataKey = "name" | "description" | "duration_min" | "price";
// type PriceSizeKey = "small" | "medium" | "large";

// export function AbaServiços() {
//   const {
//     services,
//     loadingServices,
//     createService,
//     updateService,
//     deleteService,
//   } = useSettings();
//   const toast = useToast();
//   const [isModalOpen, setIsModalOpen] = useState(false);
//   const [editingService, setEditingService] = useState<Service | null>(null);
//   const [isSaving, setIsSaving] = useState(false);

//   const [formData, setFormData] = useState({
//     name: "",
//     description: "",
//     duration_min: 60,
//     price: "",
//     priceBySize: {
//       small: "",
//       medium: "",
//       large: "",
//     },
//   });

//   const handleOpenModal = useCallback((service?: Service) => {
//     if (service) {
//       setEditingService(service);
//       setFormData({
//         name: service.name,
//         description: service.description || "",
//         duration_min: service.durationMin || 60,
//         price: service.price?.toString() || "",
//         priceBySize: {
//           small: service.priceBySize?.small?.toString() || "",
//           medium: service.priceBySize?.medium?.toString() || "",
//           large: service.priceBySize?.large?.toString() || "",
//         },
//       });
//     } else {
//       setEditingService(null);
//       setFormData({
//         name: "",
//         description: "",
//         duration_min: 60,
//         price: "",
//         priceBySize: { small: "", medium: "", large: "" },
//       });
//     }
//     setIsModalOpen(true);
//   }, []);

//   const handleCloseModal = useCallback(() => {
//     setIsModalOpen(false);
//     setEditingService(null);
//   }, []);

//   // Optimized field update - only updates specific field
//   const updateField = useCallback(
//     (key: FormDataKey, value: string | number) => {
//       setFormData((prev) => ({ ...prev, [key]: value }));
//     },
//     [],
//   );

//   // Optimized price field update
//   const updatePriceSize = useCallback((size: PriceSizeKey, value: string) => {
//     setFormData((prev) => ({
//       ...prev,
//       priceBySize: { ...prev.priceBySize, [size]: value },
//     }));
//   }, []);

//   // Compute whether any price by size is filled
//   const hasPriceBySizeValues = useMemo(
//     () => Object.values(formData.priceBySize).some((v) => v),
//     [formData.priceBySize],
//   );

//   const handleSave = useCallback(async () => {
//     if (!formData.name.trim()) {
//       toast.error("Erro", "Nome do serviço é obrigatório");
//       return;
//     }

//     setIsSaving(true);
//     try {
//       const payload = {
//         name: formData.name,
//         description: formData.description || undefined,
//         duration_min: formData.duration_min,
//         price: formData.price ? parseFloat(formData.price) : undefined,
//         price_by_size: hasPriceBySizeValues
//           ? {
//               small: formData.priceBySize.small
//                 ? parseFloat(formData.priceBySize.small)
//                 : undefined,
//               medium: formData.priceBySize.medium
//                 ? parseFloat(formData.priceBySize.medium)
//                 : undefined,
//               large: formData.priceBySize.large
//                 ? parseFloat(formData.priceBySize.large)
//                 : undefined,
//             }
//           : undefined,
//       };

//       if (editingService) {
//         await updateService(editingService.id, payload);
//         toast.success("Sucesso!", "Serviço atualizado com sucesso.");
//       } else {
//         await createService(payload);
//         toast.success("Sucesso!", "Serviço criado com sucesso.");
//       }

//       handleCloseModal();
//     } catch (error) {
//       console.error("Erro ao salvar serviço:", error);
//       toast.error("Erro", "Não foi possível salvar o serviço.");
//     } finally {
//       setIsSaving(false);
//     }
//   }, [
//     formData,
//     editingService,
//     createService,
//     updateService,
//     toast,
//     handleCloseModal,
//     hasPriceBySizeValues,
//   ]);

//   const handleDelete = useCallback(
//     async (serviceId: number) => {
//       if (confirm("Tem certeza que deseja deletar este serviço?")) {
//         try {
//           await deleteService(serviceId);
//           toast.success("Sucesso!", "Serviço deletado.");
//         } catch (error) {
//           console.error("Erro ao deletar:", error);
//           toast.error("Erro", "Não foi possível deletar o serviço.");
//         }
//       }
//     },
//     [deleteService, toast],
//   );

//   const handleToggleStatus = useCallback(
//     async (service: Service) => {
//       try {
//         await updateService(service.id, { is_active: !service.isActive });
//         toast.success(
//           "Sucesso!",
//           service.isActive ? "Serviço desativado." : "Serviço ativado.",
//         );
//       } catch (error) {
//         console.error("Erro ao alternar status:", error);
//         toast.error("Erro", "Não foi possível alterar o status do serviço.");
//       }
//     },
//     [updateService, toast],
//   );

//   if (loadingServices) {
//     return (
//       <div className="flex items-center justify-center py-12">
//         <Loader2 className="h-8 w-8 animate-spin text-[#1E62EC]" />
//       </div>
//     );
//   }

//   return (
//     <div className="space-y-6">
//       <div className="flex items-center justify-between">
//         <h3 className="text-lg font-semibold text-[#434A57] dark:text-[#f5f9fc]">
//           Serviços ({services.length})
//         </h3>
//         <Button
//           size="sm"
//           onClick={() => handleOpenModal()}
//           className="flex gap-2"
//         >
//           <Plus className="h-4 w-4" />
//           Novo Serviço
//         </Button>
//       </div>

//       <div className="grid gap-4">
//         {services.length === 0 ? (
//           <div className="rounded-lg border border-dashed border-[#727B8E]/20 p-8 text-center">
//             <p className="text-sm text-[#727B8E] dark:text-[#8a94a6]">
//               Nenhum serviço cadastrado. Clique em "Novo Serviço" para
//               adicionar.
//             </p>
//           </div>
//         ) : (
//           services.map((service) => (
//             <div
//               key={service.id}
//               className="rounded-lg border border-[#727B8E]/10 bg-white p-4 dark:border-[#40485A] dark:bg-[#1A1B1D]"
//             >
//               <div className="flex items-start justify-between">
//                 <div className="flex-1">
//                   <div className="flex items-center gap-2">
//                     <h4 className="font-semibold text-[#434A57] dark:text-[#f5f9fc]">
//                       {service.name}
//                     </h4>
//                     <span
//                       className={`text-xs px-2 py-1 rounded-full ${
//                         service.isActive
//                           ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
//                           : "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400"
//                       }`}
//                     >
//                       {service.isActive ? "Ativo" : "Inativo"}
//                     </span>
//                   </div>
//                   {service.description && (
//                     <p className="mt-1 text-sm text-[#727B8E] dark:text-[#8a94a6]">
//                       {service.description}
//                     </p>
//                   )}
//                   <div className="mt-2 flex gap-4 text-xs text-[#727B8E] dark:text-[#8a94a6]">
//                     <span>⏱️ {service.durationMin}min</span>
//                     {service.price && (
//                       <span>💰 R$ {Number(service.price).toFixed(2)}</span>
//                     )}
//                   </div>
//                 </div>
//                 <div className="ml-4 flex gap-2">
//                   <button
//                     onClick={() => handleOpenModal(service)}
//                     className="rounded p-2 hover:bg-[#F4F6F9] dark:hover:bg-[#40485A]"
//                     title="Editar"
//                   >
//                     <Edit2 className="h-4 w-4 text-[#1E62EC]" />
//                   </button>
//                   <button
//                     onClick={() => handleToggleStatus(service)}
//                     className="rounded p-2 hover:bg-[#F4F6F9] dark:hover:bg-[#40485A]"
//                     title={service.isActive ? "Desativar" : "Ativar"}
//                   >
//                     <span className="text-sm font-semibold text-[#1E62EC]">
//                       {service.isActive ? "⊘" : "✓"}
//                     </span>
//                   </button>
//                   <button
//                     onClick={() => handleDelete(service.id)}
//                     className="rounded p-2 hover:bg-[#F4F6F9] dark:hover:bg-[#40485A]"
//                     title="Deletar"
//                   >
//                     <Trash2 className="h-4 w-4 text-red-500" />
//                   </button>
//                 </div>
//               </div>
//             </div>
//           ))
//         )}
//       </div>

//       <Modal
//         isOpen={isModalOpen}
//         onClose={handleCloseModal}
//         title={editingService ? "Editar Serviço" : "Novo Serviço"}
//       >
//         <div className="space-y-4">
//           <div>
//             <label className="mb-2 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
//               Nome do Serviço
//             </label>
//             <Input
//               value={formData.name}
//               onChange={(e) => updateField("name", e.target.value)}
//               placeholder="Ex: Banho, Tosa, etc."
//             />
//           </div>

//           <div>
//             <label className="mb-2 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
//               Descrição
//             </label>
//             <TextArea
//               value={formData.description}
//               onChange={(e) => updateField("description", e.target.value)}
//               placeholder="Descrição do serviço..."
//               rows={3}
//             />
//           </div>

//           <div>
//             <label className="mb-2 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
//               Duração (minutos)
//             </label>
//             <Input
//               type="number"
//               value={formData.duration_min}
//               onChange={(e) =>
//                 updateField("duration_min", parseInt(e.target.value))
//               }
//               min="15"
//               step="15"
//             />
//           </div>

//           <div>
//             <label className="mb-2 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
//               Preço (preço único)
//             </label>
//             <Input
//               type="number"
//               value={formData.price}
//               onChange={(e) => updateField("price", e.target.value)}
//               placeholder="0.00"
//               step="0.01"
//               min="0"
//             />
//           </div>

//           <div>
//             <label className="mb-2 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
//               Preços por Tamanho (opcional)
//             </label>
//             <div className="grid grid-cols-3 gap-2">
//               {(["small", "medium", "large"] as const).map((size) => (
//                 <div key={size}>
//                   <label className="mb-1 block text-xs text-[#727B8E] dark:text-[#8a94a6]">
//                     {size === "small" ? "P" : size === "medium" ? "M" : "G"}
//                   </label>
//                   <Input
//                     type="number"
//                     value={formData.priceBySize[size]}
//                     onChange={(e) => updatePriceSize(size, e.target.value)}
//                     placeholder="0.00"
//                     step="0.01"
//                     min="0"
//                   />
//                 </div>
//               ))}
//             </div>
//           </div>
//         </div>

//         <div className="mt-6 flex gap-2">
//           <Button variant="outline" onClick={handleCloseModal}>
//             Cancelar
//           </Button>
//           <Button onClick={handleSave} disabled={isSaving}>
//             {isSaving ? (
//               <>
//                 <Loader2 className="mr-2 h-4 w-4 animate-spin" />
//                 Salvando...
//               </>
//             ) : (
//               "Salvar"
//             )}
//           </Button>
//         </div>
//       </Modal>
//     </div>
//   );
// }
