import React from 'react'
import {Label} from "@/components/ui/label";
import {Controller} from "react-hook-form";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

const SelectField = ({name, label, placeholder, options, control, error, required = false, requiredMessage}: SelectFieldProps & { requiredMessage?: string }) => {
    return (
        <div className="form-field">
            <Label htmlFor={name} className="form-label">{label}</Label>

            <Controller
                name={name}
                control={control}
                rules={{
                    required: required ? (requiredMessage ?? `Please select ${label.toLowerCase()}`) : false,
                }}
                render={({field}) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="select-trigger">
                            <SelectValue placeholder={placeholder} />
                        </SelectTrigger>
                        <SelectContent className="auth-menu">
                            {options.map((option) => (
                                <SelectItem key={option.value} value={option.value} className="auth-menu-item">
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            />
            {error && <p className="form-error">{error.message}</p>}
        </div>
    )
}
export default SelectField
