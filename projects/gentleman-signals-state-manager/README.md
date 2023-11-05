# 🚀 gentleman-signals-state-manager: ¡Manejando señales de estado como un caballero! 🎩

## English 🎩

## Description
`GManagerService` is at the heart of the `gentleman-signals-state-manager` library, a state signal management service in Angular that is not only classy, but super powerful!

### Why use `gentleman-signals-state-manager` instead of 'raw' signals?

- 🎯 **Framework-Agnostic**: Designed to work with Angular, but thanks to its agnostic design, it could be easily adapted for any frontend library or framework.

- 💼 **Simplified Signal Management**: Forget about manually handling signals and let `GManagerService` take care of everything. Add, update, and get signals with ease.

- 🛡️ **Robust**: Handles errors automatically, protecting your app against non-existent or duplicate signals.

- 🚀 **Optimized Performance**: By managing signals efficiently, `GManagerService` helps keep your app fast and agile.
  
## Recommended Usage
To start using `gentleman-signals-state-manager` in your own project, follow the format shown below:

```typescript
// Import the necessary
import { Inject, Injectable } from "@angular/core";
import { GENTLEMAN_DEFAULT_STATE, GManagerService } from "gentleman-signals-state-manager";

// Define your own service
@Injectable({
  providedIn: 'root',
})
export class SignalsManagerService<T> {
  signalsManager: GManagerService<T>;

  // Inject the initial state
  constructor(@Inject(GENTLEMAN_DEFAULT_STATE) defaultState: T) {
    this.signalsManager = new GManagerService(defaultState);
  }
}
```

And then, in your main component:

```typescript
// Provide your service and the initial state
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    ComponentitoComponent,
    Componentito2Component,
  ],
  providers: [
    SignalsManagerService<AppSignalState>,
    { provide: GENTLEMAN_DEFAULT_STATE, useValue: emptyAppSignalState },
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  title = 'Gentleman Signals State Manager';
}
```

For a complete example of how to use `gentleman-signals-state-manager`, check out the "example" folder in our GitHub repository.

To install `gentleman-signals-state-manager` in your project, head over to [the package page on npm](https://www.npmjs.com/package/gentleman-signals-state-manager).

You're all set to start managing state signals like a true gentleman! 🎩🚀

## English 🎩

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

Y luego, en tu componente principal:

```typescript
// Proporciona tu servicio y el estado inicial
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    ComponentitoComponent,
    Componentito2Component,
  ],
  providers: [
    SignalsManagerService<AppSignalState>,
    { provide: GENTLEMAN_DEFAULT_STATE, useValue: emptyAppSignalState },
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  title = 'Gentleman Signals State Manager';
}
```

Para un ejemplo completo de cómo utilizar `gentleman-signals-state-manager`, visita la carpeta "example" en nuestro repositorio de GitHub.

Para instalar `gentleman-signals-state-manager` en tu proyecto, dirígete a [la página del paquete en npm](https://www.npmjs.com/package/gentleman-signals-state-manager).

¡Estás listo para comenzar a manejar señales de estado como un verdadero caballero! 🎩🚀

