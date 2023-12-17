# 🚀 gentleman-signals-state-manager: ¡Manejando señales de estado como un caballero! 🎩

## Descripción
`GManagerService` es el corazón de la librería `gentleman-signals-state-manager`, un servicio de manejo de señales de estado en Angular que no solo es elegante, ¡sino que también es super potente!

### ¿Por qué usar `gentleman-signals-state-manager` en lugar de señales 'crudas'?

- 🎯 **Agnóstico a los frameworks**: Diseñado para funcionar con Angular, pero gracias a su diseño agnóstico, podría ser fácilmente adaptado para cualquier librería o framework de frontend.

- 💼 **Manejo de señales simplificado**: Olvídate del manejo manual de las señales y deja que `GManagerService` se ocupe de todo. Añade, actualiza y obtén señales con facilidad.

- 🛡️ **Robusto**: Maneja errores automáticamente, protegiendo tu aplicación contra señales inexistentes o duplicadas.

- 🚀 **Rendimiento optimizado**: Al manejar las señales de manera eficiente, `GManagerService` ayuda a mantener tu aplicación rápida y ágil.

## Uso Recomendado
Para comenzar a utilizar `gentleman-signals-state-manager` en tu propio proyecto, sigue el formato que se muestra a continuación:

```typescript
// Importa lo necesario
import { Inject, Injectable } from "@angular/core";
import { GENTLEMAN_DEFAULT_STATE, GManagerService } from "gentleman-signals-state-manager";

// Define tu propio servicio
@Injectable({
  providedIn: 'root',
})
export class SignalsManagerService<T> {
  signalsManager: GManagerService<T>;

  // Inyecta el estado inicial
  constructor(@Inject(GENTLEMAN_DEFAULT_STATE) defaultState: T) {
    this.signalsManager = new GManagerService(defaultState);
  }
}
```

Establece tu estado inicial dentro de tu `app.config.ts`

```ts
// app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideInitialState } from 'gentleman-signals-state-manager'

const initial initialState = {
  isLogged: false
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideInitialState(initialState),
    provideRouter(routes)
  ]
};
```

Para un ejemplo completo de cómo utilizar `gentleman-signals-state-manager`, visita la carpeta "example" en nuestro repositorio de GitHub.

Para instalar `gentleman-signals-state-manager` en tu proyecto, dirígete a [la página del paquete en npm](https://www.npmjs.com/package/gentleman-signals-state-manager).

¡Estás listo para comenzar a manejar señales de estado como un verdadero caballero! 🎩🚀
