import React from 'react'
import {Label} from "@/components/ui/label";
import {Input} from "@/components/ui/input";
import {cn} from "@/lib/utils";

const InputField = ({name, label, placeholder, type ="text", register, error, validation, disabled, value, autoComplete}: FormInputProps) => {
    const errorId = `${name}-error`;
    return (
        <div className="form-field">
            <Label htmlFor={name} className="form-label">
                {label}
            </Label>
            <Input
                type={type}
                id={name}
                placeholder={placeholder}
                disabled={disabled}
                value={value}
                autoComplete={autoComplete}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className={cn('form-input', {'opacity-50 cursor-not-allowed': disabled})}
                {...register(name, validation)}
            />
            {error && <p id={errorId} className="form-error">{error.message}</p>}
        </div>
    )
}
export default InputField
