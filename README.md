# Gentleman Signals based State Manager 

# English

This repository contains an implementation of a generic shared state service for Angular. This service uses the `SignalsManager` class to manage a shared state throughout the application.

## Description

The `SharedStateAppService` is a service that manages a generic shared state in the application. It uses the `SignalsManager` class, which maintains a collection of signals, to handle and manipulate the application state.

The application state is defined in the `AppSignalState` interface. This state can include any number of properties of various types, which are represented by the notation `[key: string]: any`. Each property in the application state will correspond to a signal in the `SignalsManager`.

The initial state of the application is defined in the `emptyAppSignalState` object. You can define the initial state for the properties you need in your application here.

The `SharedStateAppService` service is injected into the 'root' scope, which means it is a singleton and the same state will be shared across the entire application.

## Usage

The `SharedStateAppService` initializes its state with the `emptyAppSignalState`. You can add to the `emptyAppSignalState` the properties you need for your application.

To manipulate the application state, you can interact directly with `appSignalsState`. The signal manipulation methods, including `addSignal`, `removeSignal`, `getSignal`, and `updateSignal` can be used for this purpose.

For instance, to update a state property, you could call `appSignalsState.updateSignal(key, newValue)`, where `key` is the key of the property you want to update.

## Dependencies

This code relies on the `@angular/core` module and the `SignalsManager` class. Both must be present in your project for this code to work correctly.

## Contribution

Contributions are welcome. Please fork the repository and create a pull request with your changes.

## License

The code in this repository is published under the [Insert your license here]. Please refer to the LICENSE file for more details.

# Español

Este repositorio contiene una implementación de un servicio de estado compartido genérico para Angular. Este servicio utiliza la clase `SignalsManager` para manejar un estado compartido a lo largo de la aplicación.

## Descripción

El `SharedStateAppService` es un servicio que administra un estado compartido genérico en la aplicación. Utiliza la clase `SignalsManager` que mantiene una colección de señales, para administrar y manipular el estado de la aplicación.

El estado de la aplicación se define en la interfaz `AppSignalState`. Este estado puede incluir cualquier cantidad de propiedades de diferentes tipos, las cuales son representadas por la notación `[key: string]: any`. Cada propiedad en el estado de la aplicación corresponderá a una señal en el `SignalsManager`.

El estado inicial de la aplicación se define en el objeto `emptyAppSignalState`. Puede definir aquí el estado inicial para las propiedades que necesita en su aplicación.

El servicio `SharedStateAppService` se inyecta en el ámbito 'root', lo que significa que es un singleton y el mismo estado se compartirá en toda la aplicación.

## Uso

El `SharedStateAppService` inicializa su estado con el `emptyAppSignalState`. Puede añadir al `emptyAppSignalState` las propiedades que necesita para su aplicación.

Para manipular el estado de la aplicación, puede interactuar directamente con `appSignalsState`. Los métodos de manipulación de señales, entre ellos `addSignal`, `removeSignal`, `getSignal` y `updateSignal` pueden ser utilizados para este propósito.

Por ejemplo, para actualizar una propiedad del estado, podría llamar a `appSignalsState.updateSignal(key, newValue)`, donde `key` es la clave de la propiedad que desea actualizar.

## Dependencias

Este código depende del módulo `@angular/core` y de la clase `SignalsManager`. Ambos deben estar presentes en su proyecto para que este código funcione correctamente.

## Contribución

Las contribuciones son bienvenidas. Por favor, haga un 'fork' del repositorio y cree una 'pull request' con sus cambios.

## Licencia

El código en este repositorio se publica bajo la licencia MIT. Consulte el archivo LICENSE para obtener más detalles.

# AngularMeetUp

This project was generated with [Angular CLI](https://github.com/angular/angular-cli) version 16.2.0.

## Development server

Run `ng serve` for a dev server. Navigate to `http://localhost:4200/`. The application will automatically reload if you change any of the source files.

## Code scaffolding

Run `ng generate component component-name` to generate a new component. You can also use `ng generate directive|pipe|service|class|guard|interface|enum|module`.

## Build

Run `ng build` to build the project. The build artifacts will be stored in the `dist/` directory.

## Running unit tests

Run `ng test` to execute the unit tests via [Karma](https://karma-runner.github.io).

## Running end-to-end tests

Run `ng e2e` to execute the end-to-end tests via a platform of your choice. To use this command, you need to first add a package that implements end-to-end testing capabilities.

## Further help

To get more help on the Angular CLI use `ng help` or go check out the [Angular CLI Overview and Command Reference](https://angular.io/cli) page.
